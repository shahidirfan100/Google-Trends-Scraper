// Google Trends Scraper - Proper Session Context Strategy
// Uses browser session to access internal APIs that require authentication
import { Actor, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { sleep } from 'crawlee';
import { firefox } from 'playwright';

await Actor.init();

const GOOGLE_TRENDS_URL = 'https://trends.google.com';

const TIME_RANGES = {
    'now 1-H': 'now 1-H', 'now 4-H': 'now 4-H', 'now 1-d': 'now 1-d',
    'now 7-d': 'now 7-d', 'today 1-m': 'today 1-m', 'today 3-m': 'today 3-m',
    'today 12-m': 'today 12-m', 'today 5-y': 'today 5-y', 'all': 'all', '': 'today 12-m'
};

function parseApiResponse(body) {
    let cleanBody = body;
    if (cleanBody.startsWith(")]}'")) cleanBody = cleanBody.slice(4);
    if (cleanBody.startsWith("\n")) cleanBody = cleanBody.slice(1);
    return JSON.parse(cleanBody);
}

function buildExploreUrl(searchTerm, geo, timeRange, category) {
    const url = new URL(`${GOOGLE_TRENDS_URL}/trends/explore`);
    url.searchParams.set('q', searchTerm);
    url.searchParams.set('hl', 'en-US');
    if (geo) url.searchParams.set('geo', geo);
    if (timeRange) url.searchParams.set('date', TIME_RANGES[timeRange] || timeRange);
    if (category) url.searchParams.set('cat', String(category));
    return url.href;
}

function parseGoogleTrendsUrl(urlString) {
    try {
        const url = new URL(urlString);
        return {
            searchTerm: url.searchParams.get('q') || '',
            geo: url.searchParams.get('geo') || '',
            timeRange: url.searchParams.get('date') || 'today 12-m',
            category: parseInt(url.searchParams.get('cat') || '0', 10)
        };
    } catch { return null; }
}

function randomDelay(min = 2000, max = 5000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        searchTerms = [], startUrls = [], geo = '', timeRange = '',
        customTimeRange = '', category = 0, isMultiple = false,
        maxItems = 0, proxyConfiguration
    } = input;

    log.info('═══════════════════════════════════════════');
    log.info('    Google Trends Scraper');
    log.info('═══════════════════════════════════════════');

    // Build items list
    const itemsToProcess = [];
    for (const term of searchTerms) {
        if (isMultiple && term.includes(',')) {
            itemsToProcess.push(...term.split(',').map(t => t.trim()).filter(t => t));
        } else if (term) {
            itemsToProcess.push(term);
        }
    }
    for (const urlObj of startUrls) {
        const url = typeof urlObj === 'string' ? urlObj : urlObj.url;
        if (url) itemsToProcess.push(url);
    }

    if (itemsToProcess.length === 0) {
        log.error('No search terms or URLs provided.');
        await Actor.exit();
        return;
    }

    const effectiveTimeRange = customTimeRange || timeRange;
    const processLimit = maxItems > 0 ? Math.min(maxItems, itemsToProcess.length) : itemsToProcess.length;
    log.info(`Processing ${processLimit} item(s)...`);

    // Setup proxy - use RESIDENTIAL for best results
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    log.info(proxyUrl ? '✓ Proxy configured' : '⚠ No proxy - likely to be blocked');

    let successCount = 0;

    // Launch Camoufox browser
    log.info('Launching stealth browser...');
    const launchOpts = await camoufoxLaunchOptions({
        headless: true,
        proxy: proxyUrl,
        geoip: true,
        humanize: true
    });

    const browser = await firefox.launch(launchOpts);

    try {
        const context = await browser.newContext({
            viewport: { width: 1536, height: 864 },
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        const page = await context.newPage();

        // Block unnecessary resources
        await page.route('**/*', async (route) => {
            const type = route.request().resourceType();
            const url = route.request().url();
            if (['image', 'stylesheet', 'font', 'media'].includes(type) ||
                url.includes('google-analytics') || url.includes('doubleclick')) {
                return route.abort();
            }
            return route.continue();
        });

        // STEP 1: Establish session by visiting Trends homepage
        log.info('Step 1: Establishing session...');
        try {
            await page.goto(`${GOOGLE_TRENDS_URL}/trending?geo=US&hl=en-US`, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            await sleep(randomDelay(3000, 5000));

            // Check if we have access
            const content = await page.content();
            if (content.includes('trending') || content.includes('Trending')) {
                log.info('✓ Session established - Trends accessible');
            } else if (content.includes('429') || content.includes('unusual')) {
                log.error('✗ Blocked on session establishment');
                throw new Error('Blocked by Google');
            }
        } catch (e) {
            log.warning(`Session setup issue: ${e.message}`);
        }

        // Simulate human interaction
        await page.evaluate(() => window.scrollBy(0, 300));
        await sleep(randomDelay(2000, 4000));

        // Process each search term
        for (let i = 0; i < processLimit; i++) {
            const item = itemsToProcess[i];

            let searchTerm = item;
            let exploreUrl;
            let effectiveGeo = geo;
            let effectiveCat = category;
            let effectiveTime = effectiveTimeRange;

            if (item.startsWith('http')) {
                const parsed = parseGoogleTrendsUrl(item);
                if (parsed) {
                    searchTerm = parsed.searchTerm;
                    effectiveGeo = parsed.geo || geo;
                    effectiveTime = parsed.timeRange || effectiveTimeRange;
                    effectiveCat = parsed.category || category;
                }
                exploreUrl = item;
            } else {
                exploreUrl = buildExploreUrl(item, effectiveGeo, effectiveTime, effectiveCat);
            }

            if (!searchTerm) continue;

            log.info(`━━━ (${i + 1}/${processLimit}) "${searchTerm}" ━━━`);

            // Data collectors
            const capturedData = {
                interestOverTime: null,
                geoData: null,
                relatedTopics: null,
                relatedQueries: null
            };

            // Set up response interceptor
            const responseHandler = async (response) => {
                const url = response.url();
                if (response.status() !== 200) return;

                try {
                    const text = await response.text();
                    if (url.includes('/widgetdata/multiline')) {
                        capturedData.interestOverTime = parseApiResponse(text).default?.timelineData || [];
                        log.info(`  ✓ Timeline: ${capturedData.interestOverTime.length} pts`);
                    }
                    if (url.includes('/widgetdata/comparedgeo')) {
                        capturedData.geoData = parseApiResponse(text).default?.geoMapData || [];
                        log.info(`  ✓ Geo: ${capturedData.geoData.length} regions`);
                    }
                    if (url.includes('/widgetdata/relatedsearches')) {
                        const data = parseApiResponse(text).default?.rankedList || [];
                        if (!capturedData.relatedTopics) {
                            capturedData.relatedTopics = data;
                            log.info(`  ✓ Topics captured`);
                        } else {
                            capturedData.relatedQueries = data;
                            log.info(`  ✓ Queries captured`);
                        }
                    }
                } catch { }
            };

            page.on('response', responseHandler);

            try {
                // Navigate to explore page
                log.info(`  Loading explore page...`);

                const response = await page.goto(exploreUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });

                if (response && response.status() === 429) {
                    throw new Error('Rate limited (429)');
                }

                // Wait for content
                await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => { });
                await sleep(randomDelay(4000, 6000));

                // Human scroll
                await page.evaluate(() => window.scrollBy(0, 500));
                await sleep(randomDelay(2000, 3000));

                // Check for block
                const pageContent = await page.content();
                if (pageContent.includes('unusual traffic') || pageContent.includes('captcha')) {
                    throw new Error('CAPTCHA detected');
                }

                // Wait for chart to appear
                try {
                    await page.waitForSelector('.fe-line-chart, [class*="chart"], [class*="explore"]', {
                        timeout: 15000
                    });
                } catch { }

                // Extra wait for all API calls
                await sleep(randomDelay(3000, 5000));

            } catch (error) {
                log.error(`  ✗ Failed: ${error.message}`);
                page.off('response', responseHandler);

                // Long cooldown after error
                if (i < processLimit - 1) {
                    log.info('  Waiting 60s cooldown...');
                    await sleep(60000);
                }
                continue;
            }

            page.off('response', responseHandler);

            // Process results
            let topTopics = [], risingTopics = [], topQueries = [], risingQueries = [];

            for (const list of (capturedData.relatedTopics || [])) {
                if (list.rankedKeyword) {
                    const isRising = list.rankedKeyword.some(i =>
                        i.formattedValue?.includes('%') || i.formattedValue?.toLowerCase() === 'breakout'
                    );
                    if (isRising) risingTopics = list.rankedKeyword;
                    else topTopics = list.rankedKeyword;
                }
            }

            for (const list of (capturedData.relatedQueries || [])) {
                if (list.rankedKeyword) {
                    const isRising = list.rankedKeyword.some(i =>
                        i.formattedValue?.includes('%') || i.formattedValue?.toLowerCase() === 'breakout'
                    );
                    if (isRising) risingQueries = list.rankedKeyword;
                    else topQueries = list.rankedKeyword;
                }
            }

            const result = {
                inputUrlOrTerm: item,
                searchTerm,
                geo: effectiveGeo || 'Worldwide',
                timeRange: effectiveTime || 'today 12-m',
                interestOverTime_timelineData: capturedData.interestOverTime || [],
                interestOverTime_averages: [],
                interestBySubregion: effectiveGeo ? (capturedData.geoData || []) : [],
                interestByCity: [],
                interestBy: effectiveGeo ? [] : (capturedData.geoData || []),
                relatedTopics_top: topTopics,
                relatedTopics_rising: risingTopics,
                relatedQueries_top: topQueries,
                relatedQueries_rising: risingQueries
            };

            const hasData = result.interestOverTime_timelineData.length > 0 ||
                topTopics.length > 0 || topQueries.length > 0;

            if (hasData) {
                await Actor.pushData(result);
                successCount++;
                log.info(`✓ SAVED "${searchTerm}"`);
            } else {
                log.warning(`  No data captured for "${searchTerm}"`);
            }

            // Delay between terms - longer to avoid rate limits
            if (i < processLimit - 1) {
                const delay = randomDelay(15000, 30000);
                log.info(`Cooling down ${Math.round(delay / 1000)}s...`);
                await sleep(delay);
            }
        }

        await context.close();
    } finally {
        await browser.close();
    }

    log.info('═══════════════════════════════════════════');
    log.info(`    Done: ${successCount}/${processLimit} saved`);
    log.info('═══════════════════════════════════════════');

    await Actor.exit();
}

main().catch(err => {
    log.error('Fatal:', err);
    process.exit(1);
});
