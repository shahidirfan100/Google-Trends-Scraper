// Google Trends Scraper - CSV Download Approach
// Uses the download/export button to get data (like the Python selenium scraper)
import { Actor, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { sleep } from 'crawlee';
import { firefox } from 'playwright';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync } from 'fs';

await Actor.init();

const GOOGLE_TRENDS_URL = 'https://trends.google.com';

const TIME_RANGES = {
    'now 1-H': 'now 1-H', 'now 4-H': 'now 4-H', 'now 1-d': 'now 1-d',
    'now 7-d': 'now 7-d', 'today 1-m': 'today 1-m', 'today 3-m': 'today 3-m',
    'today 12-m': 'today 12-m', 'today 5-y': 'today 5-y', 'all': 'all', '': 'today 12-m'
};

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

/**
 * Parse CSV data to get timeline data
 */
function parseTimelineCsv(csvContent, keyword) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 3) return [];

    // Skip header rows (first 2-3 rows are usually headers)
    const dataStartIndex = lines.findIndex(line =>
        line.match(/^\d{4}-\d{2}-\d{2}/) || line.match(/^\w+ \d+,? \d{4}/)
    );

    if (dataStartIndex === -1) return [];

    const timelineData = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length >= 2) {
            const dateStr = parts[0].trim();
            let value = parts[1].trim();

            // Handle '<1' values
            if (value === '<1') value = '0';

            const numValue = parseInt(value, 10);
            if (!isNaN(numValue)) {
                timelineData.push({
                    time: dateStr,
                    formattedTime: dateStr,
                    value: [numValue],
                    formattedValue: [String(numValue)],
                    hasData: [numValue > 0]
                });
            }
        }
    }

    return timelineData;
}

/**
 * Parse cookies from JSON input
 */
function parseCookies(cookieInput) {
    if (!cookieInput) return [];
    try {
        const parsed = JSON.parse(cookieInput);
        if (Array.isArray(parsed)) {
            return parsed.map(c => ({
                name: c.name,
                value: c.value,
                domain: c.domain || '.google.com',
                path: c.path || '/',
                expires: c.expirationDate || c.expires || -1,
                httpOnly: c.httpOnly || false,
                secure: c.secure !== false,
                sameSite: c.sameSite || 'Lax'
            }));
        }
    } catch (e) {
        log.warning(`Cookie parse error: ${e.message}`);
    }
    return [];
}

async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        searchTerms = [], startUrls = [], geo = '', timeRange = '',
        customTimeRange = '', category = 0, isMultiple = false,
        maxItems = 0, proxyConfiguration, cookies = ''
    } = input;

    log.info('═══════════════════════════════════════════');
    log.info('    Google Trends Scraper');
    log.info('    CSV Download Method');
    log.info('═══════════════════════════════════════════');

    // Parse cookies
    const sessionCookies = parseCookies(cookies);
    log.info(sessionCookies.length > 0 ? `✓ ${sessionCookies.length} cookies loaded` : '⚠ No cookies');

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
        log.error('No search terms provided.');
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

    // Create temp download directory
    const downloadPath = mkdtempSync(join(tmpdir(), 'gtrends-'));
    log.info(`Download path: ${downloadPath}`);

    let successCount = 0;

    // Launch browser
    log.info('Launching browser...');
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
            timezoneId: 'America/New_York',
            acceptDownloads: true
        });

        // Inject cookies if available
        if (sessionCookies.length > 0) {
            await context.addCookies(sessionCookies);
            log.info('✓ Cookies injected');
        }

        const page = await context.newPage();

        // Warm up session
        log.info('Warming up session...');
        try {
            await page.goto(`${GOOGLE_TRENDS_URL}/trending?geo=US`, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await sleep(randomDelay(3000, 5000));

            const content = await page.content();
            if (content.includes('captcha') || content.includes('unusual')) {
                log.warning('⚠ CAPTCHA detected on warmup - will try anyway');
            } else {
                log.info('✓ Session ready');
            }
        } catch (e) {
            log.warning(`Warmup: ${e.message}`);
        }

        // Human behavior
        await page.evaluate(() => window.scrollBy(0, 200));
        await sleep(randomDelay(1000, 2000));

        // Process each term
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

            let timelineData = [];

            try {
                // Navigate to explore page
                log.info('  Loading page...');
                await page.goto(exploreUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await sleep(randomDelay(3000, 5000));

                // Check for CAPTCHA
                const content = await page.content();
                if (content.includes('unusual traffic') || content.includes('captcha')) {
                    throw new Error('CAPTCHA detected');
                }

                // Wait for chart widget (like Python: widget[type='fe_line_chart'])
                log.info('  Waiting for chart...');
                try {
                    await page.waitForSelector('widget[type="fe_line_chart"], .fe-line-chart, [class*="line-chart"]', {
                        timeout: 30000
                    });
                    log.info('  ✓ Chart found');
                } catch {
                    log.warning('  Chart not found, trying anyway');
                }

                await sleep(randomDelay(2000, 3000));

                // Find and click the export/download button (like Python: .widget-actions-item.export)
                log.info('  Looking for export button...');

                const downloadButton = await page.$(
                    'widget[type="fe_line_chart"] .widget-actions-item.export, ' +
                    '.fe-line-chart-header button[aria-label*="download"], ' +
                    '.fe-line-chart-header button[aria-label*="export"], ' +
                    '.widget-actions-item.export, ' +
                    'button[aria-label*="CSV"], ' +
                    '[class*="export"], ' +
                    '.line-chart-header button'
                );

                if (downloadButton) {
                    log.info('  ✓ Export button found, clicking...');

                    // Set up download handler
                    const [download] = await Promise.all([
                        page.waitForEvent('download', { timeout: 30000 }),
                        downloadButton.click()
                    ]);

                    // Save the downloaded file
                    const downloadFile = join(downloadPath, `${searchTerm.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
                    await download.saveAs(downloadFile);
                    log.info(`  ✓ Downloaded: ${download.suggestedFilename()}`);

                    // Read and parse the CSV
                    await sleep(1000);
                    if (existsSync(downloadFile)) {
                        const csvContent = await readFile(downloadFile, 'utf-8');
                        timelineData = parseTimelineCsv(csvContent, searchTerm);
                        log.info(`  ✓ Parsed ${timelineData.length} data points`);

                        // Clean up
                        await unlink(downloadFile).catch(() => { });
                    }
                } else {
                    log.warning('  Export button not found - trying API interception fallback');

                    // Fallback: try to capture from network
                    const responses = [];
                    page.on('response', async (response) => {
                        if (response.url().includes('/widgetdata/multiline') && response.status() === 200) {
                            try {
                                const text = await response.text();
                                let data = text;
                                if (data.startsWith(")]}'")) data = data.slice(4);
                                if (data.startsWith("\n")) data = data.slice(1);
                                const parsed = JSON.parse(data);
                                timelineData = parsed.default?.timelineData || [];
                            } catch { }
                        }
                    });

                    // Reload page to trigger API calls
                    await page.reload({ waitUntil: 'networkidle', timeout: 45000 }).catch(() => { });
                    await sleep(5000);
                }

            } catch (error) {
                log.error(`  ✗ Failed: ${error.message}`);

                if (i < processLimit - 1) {
                    log.info('  Waiting 60s cooldown...');
                    await sleep(60000);
                }
                continue;
            }

            // Build result
            const result = {
                inputUrlOrTerm: item,
                searchTerm,
                geo: effectiveGeo || 'Worldwide',
                timeRange: effectiveTime || 'today 12-m',
                interestOverTime_timelineData: timelineData,
                interestOverTime_averages: [],
                interestBySubregion: [],
                interestByCity: [],
                interestBy: [],
                relatedTopics_top: [],
                relatedTopics_rising: [],
                relatedQueries_top: [],
                relatedQueries_rising: []
            };

            if (timelineData.length > 0) {
                await Actor.pushData(result);
                successCount++;
                log.info(`✓ SAVED "${searchTerm}" (${timelineData.length} points)`);
            } else {
                log.warning(`  No data for "${searchTerm}"`);
            }

            // Delay between terms
            if (i < processLimit - 1) {
                const delay = randomDelay(10000, 20000);
                log.info(`Waiting ${Math.round(delay / 1000)}s...`);
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
