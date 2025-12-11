// Google Trends Scraper - Session Warm-up Strategy
// First visits Google to establish session, then navigates to Trends
import { Actor, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { sleep } from 'crawlee';
import { firefox } from 'playwright';

await Actor.init();

const GOOGLE_TRENDS_URL = 'https://trends.google.com/trends';

// Time range mappings
const TIME_RANGES = {
    'now 1-H': 'now 1-H',
    'now 4-H': 'now 4-H',
    'now 1-d': 'now 1-d',
    'now 7-d': 'now 7-d',
    'today 1-m': 'today 1-m',
    'today 3-m': 'today 3-m',
    'today 12-m': 'today 12-m',
    'today 5-y': 'today 5-y',
    'all': 'all',
    '': 'today 12-m'
};

/**
 * Strip the security prefix from Google Trends API responses
 */
function parseApiResponse(body) {
    let cleanBody = body;
    if (cleanBody.startsWith(")]}'\\n")) {
        cleanBody = cleanBody.slice(5);
    } else if (cleanBody.startsWith(")]}'")) {
        cleanBody = cleanBody.slice(4);
    } else if (cleanBody.startsWith(")]}'\n")) {
        cleanBody = cleanBody.slice(5);
    }
    return JSON.parse(cleanBody);
}

/**
 * Build Google Trends explore URL
 */
function buildExploreUrl(searchTerm, geo, timeRange, category) {
    const url = new URL(`${GOOGLE_TRENDS_URL}/explore`);
    url.searchParams.set('q', searchTerm);
    url.searchParams.set('hl', 'en-US');
    if (geo) url.searchParams.set('geo', geo);
    if (timeRange) url.searchParams.set('date', TIME_RANGES[timeRange] || timeRange);
    if (category) url.searchParams.set('cat', String(category));
    return url.href;
}

/**
 * Parse Google Trends URL to extract parameters
 */
function parseGoogleTrendsUrl(urlString) {
    try {
        const url = new URL(urlString);
        return {
            searchTerm: url.searchParams.get('q') || '',
            geo: url.searchParams.get('geo') || '',
            timeRange: url.searchParams.get('date') || 'today 12-m',
            category: parseInt(url.searchParams.get('cat') || '0', 10)
        };
    } catch (error) {
        return null;
    }
}

/**
 * Random delay for human-like behavior
 */
function randomDelay(min = 2000, max = 5000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Main execution
 */
async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        searchTerms = [],
        startUrls = [],
        geo = '',
        timeRange = '',
        customTimeRange = '',
        category = 0,
        isMultiple = false,
        maxItems = 0,
        maxRequestRetries = 5,
        proxyConfiguration
    } = input;

    log.info('═══════════════════════════════════════════');
    log.info('    Google Trends Scraper');
    log.info('    Session Warm-up Strategy');
    log.info('═══════════════════════════════════════════');

    // Build items list
    const itemsToProcess = [];
    for (const term of searchTerms) {
        if (isMultiple && term.includes(',')) {
            itemsToProcess.push(...term.split(',').map(t => t.trim()).filter(t => t));
        } else {
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

    // Setup proxy
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    log.info(proxyUrl ? '✓ Proxy configured' : '⚠ No proxy');

    let successCount = 0;

    // Launch browser once and reuse for all requests
    log.info('Launching Camoufox browser...');

    const launchOpts = await camoufoxLaunchOptions({
        headless: true,
        proxy: proxyUrl,
        geoip: true,
        humanize: true,
        screen: {
            minWidth: 1366,
            maxWidth: 1920,
            minHeight: 768,
            maxHeight: 1080
        }
    });

    const browser = await firefox.launch(launchOpts);
    log.info('✓ Browser launched');

    try {
        // Create a persistent context
        const context = await browser.newContext({
            viewport: { width: 1536, height: 864 },
            locale: 'en-US',
            timezoneId: 'America/New_York',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        });

        const page = await context.newPage();

        // STEP 1: Warm up session by visiting Google first
        log.info('Step 1: Warming up session...');
        try {
            await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(randomDelay(3000, 5000));

            // Accept cookies if prompt appears
            try {
                const acceptBtn = await page.$('button:has-text("Accept"), button:has-text("I agree"), [aria-label*="Accept"]');
                if (acceptBtn) {
                    await acceptBtn.click();
                    await sleep(1000);
                }
            } catch (e) { }

            log.info('✓ Google session established');
        } catch (e) {
            log.warning(`Session warm-up had issues: ${e.message}`);
        }

        // STEP 2: Visit Trends homepage first
        log.info('Step 2: Visiting Trends homepage...');
        try {
            await page.goto('https://trends.google.com/trending?geo=US', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(randomDelay(3000, 6000));

            // Scroll a bit
            await page.evaluate(() => window.scrollBy(0, 300));
            await sleep(randomDelay(1000, 2000));

            log.info('✓ Trends homepage loaded');
        } catch (e) {
            log.warning(`Trends homepage had issues: ${e.message}`);
        }

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

            if (!searchTerm) {
                log.warning(`Skipping invalid item: ${item}`);
                continue;
            }

            log.info(`━━━ (${i + 1}/${processLimit}) "${searchTerm}" ━━━`);

            // Captured API data
            const capturedData = {
                interestOverTime: null,
                geoData: null,
                relatedTopics: null,
                relatedQueries: null
            };

            // Listen for API responses
            const responseHandler = async (response) => {
                const url = response.url();
                try {
                    if (url.includes('/api/widgetdata/multiline')) {
                        const text = await response.text();
                        capturedData.interestOverTime = parseApiResponse(text).default?.timelineData || [];
                        log.info(`  ✓ Interest over time: ${capturedData.interestOverTime.length} points`);
                    }
                    if (url.includes('/api/widgetdata/comparedgeo')) {
                        const text = await response.text();
                        capturedData.geoData = parseApiResponse(text).default?.geoMapData || [];
                        log.info(`  ✓ Geographic data: ${capturedData.geoData.length} regions`);
                    }
                    if (url.includes('/api/widgetdata/relatedsearches')) {
                        const text = await response.text();
                        const rankedList = parseApiResponse(text).default?.rankedList || [];
                        if (!capturedData.relatedTopics) {
                            capturedData.relatedTopics = rankedList;
                            log.info(`  ✓ Related topics captured`);
                        } else if (!capturedData.relatedQueries) {
                            capturedData.relatedQueries = rankedList;
                            log.info(`  ✓ Related queries captured`);
                        }
                    }
                } catch (e) { }
            };

            page.on('response', responseHandler);

            try {
                // Navigate to explore page
                log.info(`  Navigating to explore page...`);
                await page.goto(exploreUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                // Wait for page to load
                await sleep(randomDelay(4000, 6000));

                // Wait for network to settle
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });

                // Check for blocking
                const content = await page.content();
                if (content.includes('unusual traffic') || content.includes('captcha') || content.includes('429')) {
                    throw new Error('Rate limited by Google');
                }

                // Simulate user interaction
                await page.evaluate(() => window.scrollBy(0, 400));
                await sleep(randomDelay(2000, 3000));

                // Wait for charts
                try {
                    await page.waitForSelector('.fe-line-chart, [class*="trends"]', { timeout: 15000 });
                } catch (e) { }

                // Final wait for API calls
                await sleep(randomDelay(3000, 5000));

                log.info('  ✓ Page loaded');

            } catch (error) {
                log.error(`  ✗ Navigation failed: ${error.message}`);
                page.off('response', responseHandler);

                // Wait longer before retry
                if (i < processLimit - 1) {
                    log.info('  Waiting 30s before next attempt...');
                    await sleep(30000);
                }
                continue;
            }

            page.off('response', responseHandler);

            // Process results
            let topTopics = [], risingTopics = [], topQueries = [], risingQueries = [];

            if (capturedData.relatedTopics) {
                for (const list of capturedData.relatedTopics) {
                    if (list.rankedKeyword) {
                        const isRising = list.rankedKeyword.some(item =>
                            item.formattedValue?.includes('%') || item.formattedValue?.toLowerCase() === 'breakout'
                        );
                        if (isRising) risingTopics = list.rankedKeyword;
                        else topTopics = list.rankedKeyword;
                    }
                }
            }

            if (capturedData.relatedQueries) {
                for (const list of capturedData.relatedQueries) {
                    if (list.rankedKeyword) {
                        const isRising = list.rankedKeyword.some(item =>
                            item.formattedValue?.includes('%') || item.formattedValue?.toLowerCase() === 'breakout'
                        );
                        if (isRising) risingQueries = list.rankedKeyword;
                        else topQueries = list.rankedKeyword;
                    }
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

            // Only save if we got data
            if (result.interestOverTime_timelineData.length > 0 ||
                result.relatedTopics_top.length > 0 ||
                result.relatedQueries_top.length > 0) {
                await Actor.pushData(result);
                successCount++;
                log.info(`✓ SAVED: "${searchTerm}" (${result.interestOverTime_timelineData.length} timeline pts)`);
            } else {
                log.warning(`  No data captured for "${searchTerm}"`);
            }

            // Delay between terms
            if (i < processLimit - 1) {
                const delay = randomDelay(10000, 20000);
                log.info(`Waiting ${Math.round(delay / 1000)}s before next term...`);
                await sleep(delay);
            }
        }

        await context.close();
    } finally {
        await browser.close();
    }

    log.info('═══════════════════════════════════════════');
    log.info(`    Results: ${successCount}/${processLimit} successful`);
    log.info('═══════════════════════════════════════════');

    await Actor.exit();
}

main().catch(err => {
    log.error('Fatal error:', err);
    process.exit(1);
});
