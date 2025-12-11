// Google Trends Scraper - Replicates Apify Google Trends Scraper functionality
// Uses two-step approach: 1) Get widget tokens from /explore, 2) Fetch data from widget endpoints
import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

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

// Random user agents for rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Strip the security prefix from Google Trends API responses
 */
function parseResponse(body) {
    // Check if response is HTML (blocked/error page)
    if (body.trim().startsWith('<')) {
        throw new Error('Received HTML response instead of JSON - request may be blocked');
    }

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
 * Get proxy URL from configuration
 */
function getProxyUrl(proxyConfiguration) {
    if (!proxyConfiguration) return undefined;

    if (proxyConfiguration.useApifyProxy) {
        const groups = proxyConfiguration.apifyProxyGroups?.join('+') || 'RESIDENTIAL';
        return `http://groups-${groups}:${process.env.APIFY_PROXY_PASSWORD}@proxy.apify.com:8000`;
    }

    if (proxyConfiguration.proxyUrls?.length > 0) {
        return proxyConfiguration.proxyUrls[Math.floor(Math.random() * proxyConfiguration.proxyUrls.length)];
    }

    return undefined;
}

/**
 * Make HTTP request with retry logic
 */
async function makeRequest(url, options = {}, maxRetries = 5, proxyUrl = undefined) {
    const userAgent = getRandomUserAgent();
    const headers = {
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': `${GOOGLE_TRENDS_URL}/explore?geo=US&hl=en-US`,
        'Origin': 'https://trends.google.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        ...options.headers
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log.debug(`Making request (attempt ${attempt}/${maxRetries}): ${url.substring(0, 100)}...`);

            const requestOptions = {
                url,
                method: 'GET',
                headers,
                responseType: 'text',
                timeout: { request: 60000 },
                retry: { limit: 0 },
                ...options
            };

            // Add proxy if available
            if (proxyUrl) {
                requestOptions.proxyUrl = proxyUrl;
                log.debug('Using proxy for request');
            }

            const response = await gotScraping(requestOptions);

            return parseResponse(response.body);
        } catch (error) {
            const isBlocked = error.message.includes('HTML response') ||
                error.message.includes('blocked') ||
                error.response?.statusCode === 429 ||
                error.response?.statusCode === 403;

            if (attempt < maxRetries) {
                const delay = isBlocked ? 5000 * attempt : 2000 * attempt;
                log.warning(`Request failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

/**
 * Get widget tokens from explore endpoint
 */
async function getExploreWidgets(searchTerm, geo, timeRange, category, maxRetries, proxyUrl) {
    const comparisonItem = [{
        keyword: searchTerm,
        geo: geo || '',
        time: TIME_RANGES[timeRange] || 'today 12-m'
    }];

    const req = {
        comparisonItem,
        category: category || 0,
        property: ''
    };

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/explore`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(req));

    log.info(`Fetching explore data for: "${searchTerm}"`, { geo: geo || 'Worldwide', timeRange: timeRange || 'today 12-m' });

    const data = await makeRequest(url.href, {}, maxRetries, proxyUrl);

    if (!data.widgets || data.widgets.length === 0) {
        log.warning(`No widgets returned for "${searchTerm}"`);
        return [];
    }

    log.info(`Found ${data.widgets.length} widgets for "${searchTerm}"`);
    return data.widgets;
}

/**
 * Fetch interest over time data from TIMESERIES widget
 */
async function getInterestOverTime(widget, maxRetries, proxyUrl) {
    if (!widget || !widget.token) {
        log.debug('No TIMESERIES widget available');
        return [];
    }

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/multiline`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        log.debug('Fetching interest over time data...');
        const data = await makeRequest(url.href, {}, maxRetries, proxyUrl);
        const timelineData = data.default?.timelineData || [];
        log.info(`Got ${timelineData.length} timeline data points`);
        return timelineData;
    } catch (error) {
        log.warning(`Failed to fetch interest over time: ${error.message}`);
        return [];
    }
}

/**
 * Fetch geographic interest data from GEO_MAP widget
 */
async function getGeoData(widget, maxRetries, proxyUrl) {
    if (!widget || !widget.token) {
        log.debug('No GEO_MAP widget available');
        return { interestBySubregion: [], interestByCity: [], interestBy: [] };
    }

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/comparedgeo`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        log.debug('Fetching geographic data...');
        const data = await makeRequest(url.href, {}, maxRetries, proxyUrl);
        const geoMapData = data.default?.geoMapData || [];

        log.info(`Got ${geoMapData.length} geographic data points`);

        // Categorize based on geo resolution
        const resolution = widget.resolution || widget.request?.resolution;
        if (resolution === 'provinces' || resolution === 'REGION') {
            return { interestBySubregion: geoMapData, interestByCity: [], interestBy: [] };
        } else if (resolution === 'cities' || resolution === 'CITY') {
            return { interestBySubregion: [], interestByCity: geoMapData, interestBy: [] };
        } else {
            return { interestBySubregion: [], interestByCity: [], interestBy: geoMapData };
        }
    } catch (error) {
        log.warning(`Failed to fetch geo data: ${error.message}`);
        return { interestBySubregion: [], interestByCity: [], interestBy: [] };
    }
}

/**
 * Fetch related searches (topics or queries) from widget
 */
async function getRelatedSearches(widget, widgetType, maxRetries, proxyUrl) {
    if (!widget || !widget.token) {
        log.debug(`No ${widgetType} widget available`);
        return { top: [], rising: [] };
    }

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/relatedsearches`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        log.debug(`Fetching ${widgetType} data...`);
        const data = await makeRequest(url.href, {}, maxRetries, proxyUrl);
        const rankedList = data.default?.rankedList || [];

        let top = [];
        let rising = [];

        for (const list of rankedList) {
            if (list.rankedKeyword) {
                const items = list.rankedKeyword.map(item => ({
                    ...item,
                    hasData: item.hasData !== undefined ? item.hasData : true
                }));

                // Rising items typically have formattedValue with % or "Breakout"
                const isRising = items.some(item =>
                    item.formattedValue?.includes('%') ||
                    item.formattedValue?.toLowerCase() === 'breakout'
                );

                if (isRising) {
                    rising = items;
                } else {
                    top = items;
                }
            }
        }

        log.info(`Got ${top.length} top and ${rising.length} rising ${widgetType}`);
        return { top, rising };
    } catch (error) {
        log.warning(`Failed to fetch ${widgetType}: ${error.message}`);
        return { top: [], rising: [] };
    }
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
        log.warning(`Failed to parse URL: ${urlString}`);
        return null;
    }
}

/**
 * Process a single search term and return full dataset
 */
async function processSearchTerm(inputUrlOrTerm, geo, timeRange, category, maxRetries, proxyUrl) {
    let searchTerm = inputUrlOrTerm;
    let effectiveGeo = geo;
    let effectiveTimeRange = timeRange;
    let effectiveCategory = category;

    // Check if input is a Google Trends URL
    if (inputUrlOrTerm.startsWith('http')) {
        const parsed = parseGoogleTrendsUrl(inputUrlOrTerm);
        if (parsed) {
            searchTerm = parsed.searchTerm;
            effectiveGeo = parsed.geo || geo;
            effectiveTimeRange = parsed.timeRange || timeRange;
            effectiveCategory = parsed.category || category;
        }
    }

    if (!searchTerm) {
        log.warning('No valid search term found');
        return null;
    }

    log.info(`━━━ Processing: "${searchTerm}" ━━━`);

    // Step 1: Get widget tokens from explore endpoint
    const widgets = await getExploreWidgets(
        searchTerm,
        effectiveGeo,
        effectiveTimeRange,
        effectiveCategory,
        maxRetries,
        proxyUrl
    );

    if (!widgets.length) {
        log.warning(`No widgets found for "${searchTerm}"`);
        return null;
    }

    // Find widgets by ID
    const timeseriesWidget = widgets.find(w => w.id === 'TIMESERIES');
    const geoWidget = widgets.find(w => w.id === 'GEO_MAP');
    const relatedTopicsWidget = widgets.find(w => w.id === 'RELATED_TOPICS');
    const relatedQueriesWidget = widgets.find(w => w.id === 'RELATED_QUERIES');

    // Step 2: Fetch data from each widget endpoint (with delays to avoid rate limiting)
    log.info('Fetching widget data...');

    const interestOverTime = await getInterestOverTime(timeseriesWidget, maxRetries, proxyUrl);
    await new Promise(resolve => setTimeout(resolve, 500));

    const geoData = await getGeoData(geoWidget, maxRetries, proxyUrl);
    await new Promise(resolve => setTimeout(resolve, 500));

    const relatedTopics = await getRelatedSearches(relatedTopicsWidget, 'RELATED_TOPICS', maxRetries, proxyUrl);
    await new Promise(resolve => setTimeout(resolve, 500));

    const relatedQueries = await getRelatedSearches(relatedQueriesWidget, 'RELATED_QUERIES', maxRetries, proxyUrl);

    // Build result matching Apify Google Trends Scraper output format
    const result = {
        inputUrlOrTerm,
        searchTerm,
        geo: effectiveGeo || 'Worldwide',
        timeRange: effectiveTimeRange || 'today 12-m',
        interestOverTime_timelineData: interestOverTime || [],
        interestOverTime_averages: [],
        interestBySubregion: geoData.interestBySubregion || [],
        interestByCity: geoData.interestByCity || [],
        interestBy: geoData.interestBy || [],
        relatedTopics_top: relatedTopics.top || [],
        relatedTopics_rising: relatedTopics.rising || [],
        relatedQueries_top: relatedQueries.top || [],
        relatedQueries_rising: relatedQueries.rising || []
    };

    log.info(`✓ Completed "${searchTerm}" - ${interestOverTime.length} timeline points`);
    return result;
}

/**
 * Main execution
 */
async function main() {
    try {
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

        // Get proxy URL
        const proxyUrl = getProxyUrl(proxyConfiguration);
        if (proxyUrl) {
            log.info('Using Apify Proxy');
        } else {
            log.warning('No proxy configured - requests may be blocked');
        }

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
            return;
        }

        // Apply maxItems limit
        const effectiveTimeRange = customTimeRange || timeRange;
        const processLimit = maxItems > 0 ? Math.min(maxItems, itemsToProcess.length) : itemsToProcess.length;

        log.info(`Processing ${processLimit} item(s)...`);

        let successCount = 0;
        for (let i = 0; i < processLimit; i++) {
            const item = itemsToProcess[i];

            try {
                const result = await processSearchTerm(
                    item,
                    geo,
                    effectiveTimeRange,
                    category,
                    maxRequestRetries,
                    proxyUrl
                );

                if (result) {
                    await Actor.pushData(result);
                    successCount++;
                    log.info(`Saved to dataset: "${result.searchTerm}" (${i + 1}/${processLimit})`);
                }
            } catch (error) {
                log.error(`Failed to process "${item}": ${error.message}`);
            }

            // Add delay between search terms to avoid rate limiting
            if (i < processLimit - 1) {
                log.debug('Waiting before next request...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        log.info('═══════════════════════════════════════════');
        log.info(`    Completed: ${successCount}/${processLimit} items`);
        log.info('═══════════════════════════════════════════');

    } catch (error) {
        log.error('Scraping failed', { error: error.message, stack: error.stack });
        throw error;
    }
}

main()
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await Actor.exit();
    });
