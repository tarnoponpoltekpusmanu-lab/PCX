// =========================================================================
// FLOWORK OS — Brain Crawler Module (Smart Web Crawling)
// Gives the AI "legs" — intelligent web crawling, content extraction.
//
// Tools: crawl_url, crawl_site, extract_page, crawl_status
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const pathMod = window.originalNodeRequire?.('path') || null;

    // ─── State ──────────────────────────────────────────────────────
    const _crawlJobs = {};     // jobId → { urls, results, status, ... }
    let _crawlCounter = 0;
    const RATE_LIMIT_MS = 1200;     // 1.2s between requests — polite crawling
    const MAX_PAGES_PER_CRAWL = 50;
    const MAX_CONTENT_LENGTH = 50000;  // 50KB per page

    // ─── Fetch via Go backend or direct ─────────────────────────────
    async function _fetchUrl(url, timeout = 15000) {
        // Strategy 1: Go backend proxy (handles CORS)
        try {
            const resp = await fetch('http://127.0.0.1:5000/api/web-fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, timeout }),
                signal: AbortSignal.timeout(timeout),
            });
            if (resp.ok) {
                const data = await resp.json();
                return { html: data.content || data.html || data.body || '', status: data.statusCode || 200, url };
            }
        } catch(e) {}

        // Strategy 2: Direct fetch (may hit CORS in browser)
        try {
            const resp = await fetch(url, {
                signal: AbortSignal.timeout(timeout),
                headers: { 'User-Agent': 'FloworkBot/1.0 (+https://floworkos.com)' },
            });
            const html = await resp.text();
            return { html, status: resp.status, url };
        } catch(e) {
            return { html: '', status: 0, url, error: e.message };
        }
    }

    // ─── Extract readable content from HTML ─────────────────────────
    function _extractReadable(html, url) {
        // Remove scripts, styles, nav, header, footer
        let clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[\s\S]*?<\/aside>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '');

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Extract meta description
        const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i);
        const description = metaMatch ? metaMatch[1] : '';

        // Extract headings
        const headings = [];
        const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
        let hMatch;
        while ((hMatch = headingRegex.exec(clean)) !== null) {
            headings.push({ level: parseInt(hMatch[1]), text: hMatch[2].replace(/<[^>]+>/g, '').trim() });
        }

        // Strip all remaining HTML tags
        let text = clean
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();

        // Extract links
        const links = [];
        const linkRegex = /<a[^>]*href=["'](.*?)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let lMatch;
        while ((lMatch = linkRegex.exec(html)) !== null) {
            const href = lMatch[1];
            if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
                try {
                    const absUrl = new URL(href, url).href;
                    links.push(absUrl);
                } catch(e) {}
            }
        }

        return {
            title,
            description,
            text: text.substring(0, MAX_CONTENT_LENGTH),
            headings,
            links: [...new Set(links)],  // dedupe
            wordCount: text.split(/\s+/).filter(Boolean).length,
        };
    }

    // ─── Tool: Crawl single URL ─────────────────────────────────────
    async function crawlUrl(input) {
        const url = input.url || input.link;
        if (!url) return { error: 'Missing URL. Usage: crawl_url { url: "https://example.com" }' };

        try {
            const fetched = await _fetchUrl(url);
            if (fetched.error) return { error: `Failed to fetch: ${fetched.error}` };

            const content = _extractReadable(fetched.html, url);
            const output = input.raw ? fetched.html.substring(0, MAX_CONTENT_LENGTH) : null;

            // Save to file if requested
            if (input.save && fs && pathMod) {
                const fileName = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80) + '.md';
                const savePath = pathMod.resolve(window._fmBasePath || '.', input.save_dir || 'crawled', fileName);
                const dir = pathMod.dirname(savePath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(savePath, `# ${content.title}\n\n${content.description}\n\n${content.text}`);
            }

            return {
                result: `🕷️ CRAWL RESULT\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n` +
                        `URL: ${url}\\n` +
                        `Title: ${content.title}\\n` +
                        `Description: ${content.description}\\n` +
                        `Words: ${content.wordCount}\\n` +
                        `Links found: ${content.links.length}\\n` +
                        `Headings: ${content.headings.map(h => `${'#'.repeat(h.level)} ${h.text}`).join(' | ')}\\n\\n` +
                        `--- CONTENT ---\\n${content.text.substring(0, 3000)}\\n--- END ---` +
                        (output ? `\\n\\n--- RAW HTML ---\\n${output.substring(0, 2000)}` : '') +
                        (input.save ? `\\nSaved to: ${input.save_dir || 'crawled/'}` : '')
            };
        } catch(err) {
            return { error: `Crawl failed: ${err.message}` };
        }
    }

    // ─── Tool: Crawl entire site ────────────────────────────────────
    async function crawlSite(input) {
        const startUrl = input.url || input.site;
        if (!startUrl) return { error: 'Missing URL. Usage: crawl_site { url: "https://docs.example.com", max: 20 }' };

        const maxPages = Math.min(input.max || input.max_pages || 20, MAX_PAGES_PER_CRAWL);
        const pattern = input.pattern || null;    // URL pattern to follow
        const sameDomain = input.same_domain !== false;

        const jobId = `crawl_${++_crawlCounter}`;
        const baseOrigin = new URL(startUrl).origin;

        const job = {
            id: jobId,
            startUrl,
            status: 'running',
            maxPages,
            visited: new Set(),
            queue: [startUrl],
            results: [],
            errors: [],
            startedAt: new Date().toISOString(),
            endedAt: null,
        };
        _crawlJobs[jobId] = job;

        // Run async
        (async () => {
            while (job.queue.length > 0 && job.results.length < maxPages && job.status === 'running') {
                const url = job.queue.shift();
                if (job.visited.has(url)) continue;
                job.visited.add(url);

                try {
                    const fetched = await _fetchUrl(url);
                    if (fetched.error) {
                        job.errors.push({ url, error: fetched.error });
                        continue;
                    }

                    const content = _extractReadable(fetched.html, url);
                    job.results.push({
                        url,
                        title: content.title,
                        wordCount: content.wordCount,
                        text: content.text.substring(0, 5000),
                    });

                    // Save if requested
                    if (input.save && fs && pathMod) {
                        const fileName = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80) + '.md';
                        const savePath = pathMod.resolve(window._fmBasePath || '.', input.save_dir || 'crawled', fileName);
                        const dir = pathMod.dirname(savePath);
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(savePath, `# ${content.title}\n\nSource: ${url}\n\n${content.text}`);
                    }

                    // Enqueue new links
                    for (const link of content.links) {
                        if (job.visited.has(link)) continue;
                        if (sameDomain && !link.startsWith(baseOrigin)) continue;
                        if (pattern && !link.includes(pattern)) continue;
                        // Skip non-page resources
                        if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|ico)(\?|$)/i.test(link)) continue;
                        job.queue.push(link);
                    }

                    // Rate limit
                    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

                } catch(err) {
                    job.errors.push({ url, error: err.message });
                }
            }

            job.status = 'done';
            job.endedAt = new Date().toISOString();
            console.log(`[Crawler] ✅ ${jobId} done: ${job.results.length} pages crawled`);
        })().catch(err => {
            job.status = 'error';
            job.errors.push({ url: 'system', error: err.message });
            job.endedAt = new Date().toISOString();
        });

        return {
            result: `🕷️ Site crawl started: ${jobId}\\n` +
                    `Start URL: ${startUrl}\\n` +
                    `Max pages: ${maxPages}\\n` +
                    `Same domain: ${sameDomain}\\n` +
                    `Pattern: ${pattern || 'any'}\\n` +
                    `Save: ${input.save ? 'yes → ' + (input.save_dir || 'crawled/') : 'no (in-memory)'}\\n\\n` +
                    `Use crawl_status { id: "${jobId}" } to check progress.`
        };
    }

    // ─── Tool: Extract single page content ──────────────────────────
    async function extractPage(input) {
        const url = input.url;
        if (!url) return { error: 'Missing URL.' };

        const fetched = await _fetchUrl(url);
        if (fetched.error) return { error: `Fetch failed: ${fetched.error}` };

        const content = _extractReadable(fetched.html, url);
        return {
            result: JSON.stringify({
                title: content.title,
                description: content.description,
                wordCount: content.wordCount,
                headings: content.headings,
                text: content.text.substring(0, 8000),
                linkCount: content.links.length,
            }, null, 2)
        };
    }

    // ─── Tool: Crawl status ─────────────────────────────────────────
    function crawlStatus(input) {
        const id = input.id || input.job_id;
        if (id && _crawlJobs[id]) {
            const job = _crawlJobs[id];
            let report = `🕷️ CRAWL STATUS: ${id}\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;
            report += `Status: ${job.status === 'done' ? '✅ DONE' : job.status === 'error' ? '❌ ERROR' : '🔄 RUNNING'}\\n`;
            report += `Pages: ${job.results.length}/${job.maxPages}\\n`;
            report += `Errors: ${job.errors.length}\\n`;
            report += `Queue remaining: ${job.queue.length}\\n`;
            report += `Started: ${job.startedAt}\\n`;
            report += job.endedAt ? `Ended: ${job.endedAt}\\n` : '';
            report += `\\nPages crawled:\\n`;
            for (const r of job.results) {
                report += `  • ${r.title || '(no title)'} — ${r.url} (${r.wordCount} words)\\n`;
            }
            return { result: report };
        }

        // List all jobs
        const jobs = Object.values(_crawlJobs);
        if (jobs.length === 0) return { result: 'No crawl jobs. Use crawl_url or crawl_site to start.' };

        let report = `🕷️ ALL CRAWL JOBS (${jobs.length})\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;
        for (const job of jobs) {
            const icon = job.status === 'done' ? '✅' : job.status === 'error' ? '❌' : '🔄';
            report += `${icon} ${job.id}: ${job.results.length} pages | ${job.startUrl}\\n`;
        }
        return { result: report };
    }

    // ─── Expose ──────────────────────────────────────────────────────
    window.floworkCrawler = {
        crawlUrl,
        crawlSite,
        extractPage,
        crawlStatus,
    };

    console.log('[Brain] ✅ Crawler module loaded (smart web crawling)');

})();
