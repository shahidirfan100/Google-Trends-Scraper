# Google Trends Scraper

Extract real-time search trends and insights from Google Trends. Monitor trending keywords, analyze search interest over time, track daily trending queries, and access autocomplete suggestions for comprehensive trend analysis.

## Overview

This actor provides direct access to Google Trends data, allowing you to analyze search patterns, discover emerging trends, and track keyword popularity across different regions and time periods. Perfect for market research, SEO analysis, content strategy, and competitive intelligence.

## Key Features

- **Real-Time Trend Data** — Access current trending searches and historical trend data
- **Multiple Query Methods** — Choose from explore, autocomplete, daily trends, or real-time trends endpoints
- **Global Coverage** — Query trends from any country or region worldwide
- **Flexible Time Ranges** — Analyze trends from the last hour to the last 5 years
- **Reliable Data Extraction** — Automatic retry logic handles rate limits and connection issues
- **Export-Ready Results** — Clean JSON output ready for analysis and integration

## What You Can Do

- Discover what people are searching for right now
- Compare search interest for multiple keywords across time
- Find related queries and topics
- Get search suggestions and autocomplete data
- Analyze regional search trends
- Track trending news stories and topics
- Monitor keyword popularity over time periods

## Use Cases

- **Content Marketing** — Find trending topics to create timely, relevant content
- **SEO Research** — Identify high-potential keywords and search opportunities
- **Market Analysis** — Understand consumer interest and market demand
- **Competitive Intelligence** — Track competitor keyword rankings and strategies
- **News & Publishing** — Stay ahead with breaking trends and emerging stories
- **Business Planning** — Make data-driven decisions based on search trends
- **Academic Research** — Analyze public interest in specific topics

## Input Configuration

### Endpoint Selection

Choose one of four endpoints based on your needs:

| Endpoint | Purpose | Best For |
|----------|---------|----------|
| **explore** | Compare keyword interest over time | Keyword analysis, trend comparison |
| **autocomplete** | Get search suggestions | Finding related searches, keyword ideas |
| **dailytrends** | Daily trending searches by region | Current news and trending topics |
| **realtimetrends** | Real-time trending searches | Breaking news, viral topics |

### Global Parameters

```json
{
  "hl": "en-US",
  "tz": -480,
  "maxRetries": 3
}
```

- `hl` — Interface language (e.g., "en-US", "de-DE", "ja-JP") — Default: `en-US`
- `tz` — Timezone offset in minutes (e.g., -480 for PST, -300 for EST, 0 for UTC) — Default: `-480`
- `maxRetries` — Number of automatic retry attempts on connection failures — Default: `3`

### Endpoint-Specific Parameters

#### Explore Endpoint
Analyze search interest for keywords over time with regional and topical insights.

```json
{
  "endpoint": "explore",
  "keywords": ["sustainable energy", "renewable energy"],
  "geo": "US",
  "timeRange": "today 12-m",
  "category": 0,
  "property": ""
}
```

| Parameter | Type | Description | Required | Default |
|-----------|------|-------------|----------|---------|
| `keywords` | Array | Keywords to analyze (up to 5) | Yes | — |
| `geo` | String | ISO 3166-1 country/region code | No | `US` |
| `timeRange` | String | Time range for analysis | No | `today 12-m` |
| `category` | Number | Category ID (0 = all) | No | `0` |
| `property` | String | Property filter (news, youtube, images, froogle) | No | `""` |

**Time Range Options:**
- `now 1-H` — Last hour
- `now 4-H` — Last 4 hours
- `now 1-d` — Last 24 hours
- `now 7-d` — Last 7 days
- `today 1-m` — Last month
- `today 3-m` — Last 3 months
- `today 12-m` — Last year
- `today 5-y` — Last 5 years
- `all` — All available data

#### Autocomplete Endpoint
Get real-time search suggestions and related queries.

```json
{
  "endpoint": "autocomplete",
  "query": "artificial intelligence",
  "hl": "en-US",
  "tz": -480
}
```

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `query` | String | Search query for suggestions | Yes |

#### Daily Trends Endpoint
Discover what's trending today in specific regions.

```json
{
  "endpoint": "dailytrends",
  "geo": "US",
  "hl": "en-US"
}
```

| Parameter | Type | Description | Required | Default |
|-----------|------|-------------|----------|---------|
| `geo` | String | ISO 3166-1 country/region code | No | `US` |

#### Real-Time Trends Endpoint
Access breaking news and real-time trending searches.

```json
{
  "endpoint": "realtimetrends",
  "geo": "US",
  "category": "all"
}
```

| Parameter | Type | Description | Required | Default |
|-----------|------|-------------|----------|---------|
| `geo` | String | ISO 3166-1 country/region code | No | `US` |
| `category` | String | Trend category | No | `all` |

## Output Format

### Explore Endpoint Output
```json
{
  "endpoint": "explore",
  "keywords": ["sustainable energy"],
  "geo": "US",
  "timeRange": "today 12-m",
  "widgets": [
    {
      "title": "Interest over time",
      "data": []
    },
    {
      "title": "Interest by region",
      "data": []
    },
    {
      "title": "Related topics",
      "data": []
    },
    {
      "title": "Related queries",
      "data": []
    }
  ]
}
```

### Autocomplete Endpoint Output
```json
{
  "endpoint": "autocomplete",
  "query": "artificial intelligence",
  "suggestions": []
}
```

### Daily Trends Endpoint Output
```json
{
  "endpoint": "dailytrends",
  "geo": "US",
  "date": "20250101",
  "trending": [
    {
      "title": "Trending topic",
      "traffic": "50K+",
      "articles": []
    }
  ]
}
```

### Real-Time Trends Endpoint Output
```json
{
  "endpoint": "realtimetrends",
  "geo": "US",
  "items": [
    {
      "title": "Trending search",
      "traffic": "rising",
      "articles": []
    }
  ]
}
```

## Common Configurations

### Example 1: Compare Multiple Keywords
Track search interest for competing products:

```json
{
  "endpoint": "explore",
  "keywords": ["electric vehicles", "hybrid cars", "fuel efficiency"],
  "geo": "US",
  "timeRange": "today 5-y"
}
```

### Example 2: Find Trending Topics Today
Get today's trending searches in your market:

```json
{
  "endpoint": "dailytrends",
  "geo": "GB"
}
```

### Example 3: Real-Time Search Monitoring
Monitor breaking stories and viral topics:

```json
{
  "endpoint": "realtimetrends",
  "geo": "US"
}
```

### Example 4: Keyword Research
Generate keyword ideas through autocomplete:

```json
{
  "endpoint": "autocomplete",
  "query": "content marketing",
  "hl": "en-US"
}
```

### Example 5: Regional Analysis
Compare trends across European countries:

```json
{
  "endpoint": "explore",
  "keywords": ["digital marketing"],
  "geo": "DE",
  "timeRange": "today 3-m"
}
```

## Regional Coverage

Supported regions use ISO 3166-1 alpha-2 country codes:

| Region | Code | Region | Code |
|--------|------|--------|------|
| United States | US | United Kingdom | GB |
| Canada | CA | Australia | AU |
| Germany | DE | France | FR |
| Japan | JP | India | IN |
| Brazil | BR | Mexico | MX |

Plus support for 190+ countries worldwide.

## Data Insights

Each result includes:

- **Interest Metrics** — Normalized search volume data
- **Regional Breakdown** — Traffic by geography
- **Related Content** — Associated queries and topics
- **Temporal Data** — Time-based trend patterns
- **News Articles** — Related news stories and sources
- **Recommendation** — Suggested related searches

## Performance Notes

- Results are cached and updated regularly
- Rate limits apply for high-volume requests
- Automatic retry mechanism handles temporary failures
- Timezone affects data boundaries for time-based queries
- Regional codes must match Google Trends coverage

## Tips for Best Results

1. **Be Specific** — Use precise keywords for more accurate trend data
2. **Consider Timing** — Trends are time-sensitive; analyze current data regularly
3. **Regional Context** — Different regions show different search patterns
4. **Combine Endpoints** — Use explore for analysis, dailytrends for news monitoring
5. **Time Ranges** — Longer ranges show patterns, shorter ranges show current trends
6. **Multiple Keywords** — Compare related keywords to understand market dynamics
7. **Export Regularly** — Schedule regular exports to track trend evolution

## Troubleshooting

**No Data Returned**
- Verify the keyword exists and has search volume
- Check that the region code is valid
- Ensure the time range has sufficient data

**Rate Limit Errors**
- Reduce request frequency
- Increase maxRetries value
- Space out multiple queries

**Regional Data Unavailable**
- Some regions have limited trend data
- Try a larger geographic area
- Use worldwide coverage as alternative

## Data Accuracy

Data reflects actual Google Trends queries and is updated continuously. Regional variations and language considerations affect results. For time-sensitive analysis, query multiple time ranges for context.

## Privacy & Compliance

This actor accesses publicly available Google Trends data. Results are anonymized search aggregations without identifying individual users. Comply with local data protection regulations when using trend data.

## Next Steps

1. Configure your input parameters based on your use case
2. Run the actor on your preferred schedule
3. Export results to your analysis tools
4. Monitor trends and adjust strategy accordingly