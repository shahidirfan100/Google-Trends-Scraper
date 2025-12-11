// Google Trends Scraper - Using Camoufox for stealth browsing
// Intercepts API responses directly from the browser
import { Actor, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { PlaywrightCrawler } from 'crawlee';
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
        const q = url.searchParams.get('q') || '';
        const geo = url.searchParams.get('geo') || '';
        const date = url.searchParams.get('date') || 'today 12-m';
        const cat = url.searchParams.get('cat') || '0';

        return {
            searchTerm: q,
            geo,
            timeRange: date,
            category: parseInt(cat, 10)
        };
    } catch (error) {
        return null;
    }
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
    log.info('    Google Trends Scraper - Starting');
    log.info('═══════════════════════════════════════════');
    log.info(`Search terms: ${searchTerms.length}, Start URLs: ${startUrls.length}`);
    log.info(`Geo: ${geo || 'Worldwide'}, Time range: ${timeRange || 'today 12-m'}`);

    // Build list of items to process
    const itemsToProcess = [];

    // Add search terms
    for (const term of searchTerms) {
        if (isMultiple && term.includes(',')) {
            const splitTerms = term.split(',').map(t => t.trim()).filter(t => t);
            itemsToProcess.push(...splitTerms);
        } else {
            itemsToProcess.push(term);
        }
    }

    // Add start URLs
    for (const urlObj of startUrls) {
        const url = typeof urlObj === 'string' ? urlObj : urlObj.url;
        if (url) {
            itemsToProcess.push(url);
        }
    }

    if (itemsToProcess.length === 0) {
        log.error('No search terms or URLs provided. Please add searchTerms or startUrls in input.');
        await Actor.exit();
        return;
    }

    // Apply maxItems limit
    const effectiveTimeRange = customTimeRange || timeRange;
    const processLimit = maxItems > 0 ? Math.min(maxItems, itemsToProcess.length) : itemsToProcess.length;

    log.info(`Processing ${processLimit} item(s) using Camoufox...`);

    // Setup proxy configuration
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;

    log.info(proxyUrl ? 'Using Apify Proxy with Camoufox' : 'No proxy configured');

    // Process each search term
    let successCount = 0;

    for (let i = 0; i < processLimit; i++) {
        const item = itemsToProcess[i];

        // Determine search term and URL
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

        log.info(`━━━ Processing (${i + 1}/${processLimit}): "${searchTerm}" ━━━`);
        log.info(`URL: ${exploreUrl}`);

        // Captured API responses
        const capturedData = {
            interestOverTime: null,
            geoData: null,
            relatedTopics: null,
            relatedQueries: null
        };

        try {
            // Get fresh proxy URL for each request
            const currentProxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;

            const crawler = new PlaywrightCrawler({
                maxRequestRetries,
                requestHandlerTimeoutSecs: 180,
                navigationTimeoutSecs: 90,

                launchContext: {
                    launcher: firefox,
                    launchOptions: await camoufoxLaunchOptions({
                        headless: true,
                        proxy: currentProxyUrl,
                        geoip: true,
                    }),
                },

                preNavigationHooks: [
                    async ({ page }) => {
                        // Block unnecessary resources for faster loading
                        await page.route('**/*', async (route) => {
                            const resourceType = route.request().resourceType();
                            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                                await route.abort();
                                return;
                            }
                            await route.continue();
                        });

                        // Intercept API responses
                        page.on('response', async (response) => {
                            const url = response.url();

                            try {
                                if (url.includes('/api/widgetdata/multiline')) {
                                    const text = await response.text();
                                    const data = parseApiResponse(text);
                                    capturedData.interestOverTime = data.default?.timelineData || [];
                                    log.info(`✓ Captured interest over time: ${capturedData.interestOverTime.length} points`);
                                }

                                if (url.includes('/api/widgetdata/comparedgeo')) {
                                    const text = await response.text();
                                    const data = parseApiResponse(text);
                                    capturedData.geoData = data.default?.geoMapData || [];
                                    log.info(`✓ Captured geo data: ${capturedData.geoData.length} regions`);
                                }

                                if (url.includes('/api/widgetdata/relatedsearches')) {
                                    const text = await response.text();
                                    const data = parseApiResponse(text);
                                    const rankedList = data.default?.rankedList || [];

                                    // Determine if topics or queries based on request
                                    if (!capturedData.relatedTopics) {
                                        capturedData.relatedTopics = rankedList;
                                        log.info(`✓ Captured related topics`);
                                    } else if (!capturedData.relatedQueries) {
                                        capturedData.relatedQueries = rankedList;
                                        log.info(`✓ Captured related queries`);
                                    }
                                }
                            } catch (e) {
                                // Ignore parse errors for non-JSON responses
                            }
                        });
                    }
                ],

                requestHandler: async ({ page }) => {
                    log.info('Page loaded, waiting for data...');

                    // Wait for network to be idle
                    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });

                    // Additional wait for dynamic content
                    await page.waitForTimeout(5000);

                    // Try to wait for chart elements
                    try {
                        await page.waitForSelector('[class*="line-chart"], .fe-atoms-generic-title, [class*="interest"]', {
                            timeout: 15000
                        });
                    } catch (e) {
                        log.debug('Chart elements not found, continuing...');
                    }

                    // Wait for remaining API calls
                    await page.waitForTimeout(3000);

                    log.info('Data capture complete');
                }
            });

            await crawler.run([{ url: exploreUrl }]);

            // Process captured data
            let topTopics = [];
            let risingTopics = [];
            let topQueries = [];
            let risingQueries = [];

            // Process related topics
            if (capturedData.relatedTopics) {
                for (const list of capturedData.relatedTopics) {
                    if (list.rankedKeyword) {
                        const items = list.rankedKeyword;
                        const isRising = items.some(item =>
                            item.formattedValue?.includes('%') ||
                            item.formattedValue?.toLowerCase() === 'breakout'
                        );
                        if (isRising) {
                            risingTopics = items;
                        } else {
                            topTopics = items;
                        }
                    }
                }
            }

            // Process related queries  
            if (capturedData.relatedQueries) {
                for (const list of capturedData.relatedQueries) {
                    if (list.rankedKeyword) {
                        const items = list.rankedKeyword;
                        const isRising = items.some(item =>
                            item.formattedValue?.includes('%') ||
                            item.formattedValue?.toLowerCase() === 'breakout'
                        );
                        if (isRising) {
                            risingQueries = items;
                        } else {
                            topQueries = items;
                        }
                    }
                }
            }

            // Determine geo data type
            let interestBySubregion = [];
            let interestByCity = [];
            let interestBy = [];

            if (capturedData.geoData && capturedData.geoData.length > 0) {
                if (effectiveGeo) {
                    interestBySubregion = capturedData.geoData;
                } else {
                    interestBy = capturedData.geoData;
                }
            }

            // Build result
            const result = {
                inputUrlOrTerm: item,
                searchTerm,
                geo: effectiveGeo || 'Worldwide',
                timeRange: effectiveTime || 'today 12-m',
                interestOverTime_timelineData: capturedData.interestOverTime || [],
                interestOverTime_averages: [],
                interestBySubregion,
                interestByCity,
                interestBy,
                relatedTopics_top: topTopics,
                relatedTopics_rising: risingTopics,
                relatedQueries_top: topQueries,
                relatedQueries_rising: risingQueries
            };

            await Actor.pushData(result);
            successCount++;
            log.info(`✓ Saved "${searchTerm}" - ${result.interestOverTime_timelineData.length} timeline points`);

        } catch (error) {
            log.error(`Failed to process "${searchTerm}": ${error.message}`);
        }

        // Delay between requests
        if (i < processLimit - 1) {
            log.info('Waiting before next request...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    log.info('═══════════════════════════════════════════');
    log.info(`    Completed: ${successCount}/${processLimit} items`);
    log.info('═══════════════════════════════════════════');

    await Actor.exit();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
