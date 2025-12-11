// Google Trends Scraper - Replicates Apify Google Trends Scraper functionality
// Uses two-step approach: 1) Get widget tokens from /explore, 2) Fetch data from widget endpoints
import { Actor, log } from 'apify';
import gotScraping from 'got-scraping';

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
function parseResponse(body) {
    if (body.startsWith(")]}'\\n")) {
        body = body.slice(5);
    } else if (body.startsWith(")]}'")) {
        body = body.slice(4);
    } else if (body.startsWith(")]}'\n")) {
        body = body.slice(5);
    }
    return JSON.parse(body);
}

/**
 * Make HTTP request with retry logic
 */
async function makeRequest(url, options = {}, maxRetries = 5) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `${GOOGLE_TRENDS_URL}/explore`,
        ...options.headers
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await gotScraping({
                url,
                method: 'GET',
                headers,
                responseType: 'text',
                timeout: { request: 30000 },
                ...options
            });

            return parseResponse(response.body);
        } catch (error) {
            if (attempt < maxRetries) {
                log.warning(`Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            } else {
                throw error;
            }
        }
    }
}

/**
 * Get widget tokens from explore endpoint
 */
async function getExploreWidgets(searchTerm, geo, timeRange, category, maxRetries) {
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

    log.info(`Fetching explore data for: "${searchTerm}"`, { geo, timeRange });

    const data = await makeRequest(url.href, {}, maxRetries);
    return data.widgets || [];
}

/**
 * Fetch interest over time data from TIMESERIES widget
 */
async function getInterestOverTime(widget, maxRetries) {
    if (!widget || !widget.token) return null;

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/multiline`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        const data = await makeRequest(url.href, {}, maxRetries);
        return data.default?.timelineData || [];
    } catch (error) {
        log.warning(`Failed to fetch interest over time: ${error.message}`);
        return [];
    }
}

/**
 * Fetch geographic interest data from GEO_MAP widget
 */
async function getGeoData(widget, maxRetries) {
    if (!widget || !widget.token) return { interestBySubregion: [], interestByCity: [], interestBy: [] };

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/comparedgeo`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        const data = await makeRequest(url.href, {}, maxRetries);
        const geoMapData = data.default?.geoMapData || [];

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
async function getRelatedSearches(widget, maxRetries) {
    if (!widget || !widget.token) return { top: [], rising: [] };

    const url = new URL(`${GOOGLE_TRENDS_URL}/api/widgetdata/relatedsearches`);
    url.searchParams.set('hl', 'en-US');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('req', JSON.stringify(widget.request));
    url.searchParams.set('token', widget.token);

    try {
        const data = await makeRequest(url.href, {}, maxRetries);
        const rankedList = data.default?.rankedList || [];

        let top = [];
        let rising = [];

        for (const list of rankedList) {
            if (list.rankedKeyword) {
                // Check if this is top or rising based on the data
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

        return { top, rising };
    } catch (error) {
        log.warning(`Failed to fetch related searches: ${error.message}`);
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
async function processSearchTerm(inputUrlOrTerm, geo, timeRange, category, maxRetries) {
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

    log.info(`Processing search term: "${searchTerm}"`, {
        geo: effectiveGeo,
        timeRange: effectiveTimeRange
    });

    // Step 1: Get widget tokens from explore endpoint
    const widgets = await getExploreWidgets(
        searchTerm,
        effectiveGeo,
        effectiveTimeRange,
        effectiveCategory,
        maxRetries
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

    // Step 2: Fetch data from each widget endpoint
    const [interestOverTime, geoData, relatedTopics, relatedQueries] = await Promise.all([
        getInterestOverTime(timeseriesWidget, maxRetries),
        getGeoData(geoWidget, maxRetries),
        getRelatedSearches(relatedTopicsWidget, maxRetries),
        getRelatedSearches(relatedQueriesWidget, maxRetries)
    ]);

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
            maxRequestRetries = 5
        } = input;

        log.info('Starting Google Trends Scraper', {
            searchTermsCount: searchTerms.length,
            startUrlsCount: startUrls.length,
            geo,
            timeRange
        });

        // Build list of items to process
        const itemsToProcess = [];

        // Add search terms
        for (const term of searchTerms) {
            if (isMultiple && term.includes(',')) {
                // Split by comma if isMultiple is enabled
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
            log.error('No search terms or URLs provided');
            return;
        }

        // Apply maxItems limit
        const effectiveTimeRange = customTimeRange || timeRange;
        const processLimit = maxItems > 0 ? Math.min(maxItems, itemsToProcess.length) : itemsToProcess.length;

        log.info(`Processing ${processLimit} items`);

        let successCount = 0;
        for (let i = 0; i < processLimit; i++) {
            const item = itemsToProcess[i];

            try {
                const result = await processSearchTerm(
                    item,
                    geo,
                    effectiveTimeRange,
                    category,
                    maxRequestRetries
                );

                if (result) {
                    await Actor.pushData(result);
                    successCount++;
                    log.info(`✓ Saved data for: "${result.searchTerm}" (${i + 1}/${processLimit})`);
                }
            } catch (error) {
                log.error(`Failed to process "${item}": ${error.message}`);
            }

            // Add delay between requests to avoid rate limiting
            if (i < processLimit - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        log.info(`Scraping completed. Successfully processed ${successCount}/${processLimit} items.`);

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
