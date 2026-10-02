    seen.add(url);
    candidates.push({
      provider: provider.name,
      providerKey: provider.key,
      type: classified.type,
      url,
      providerReference: provider.key,
      quality: classified.quality,
      language: 'ar',
      label: `${provider.name} ${classified.quality === 'auto' ? 'Auto' : classified.quality}`,
      expiresAt: undefined,
      sourceUrl: pageUrl,
    });
  };

  for (const source of parseQualitySources(html, pageUrl, provider)) {
    if (!seen.has(source.url)) {
      seen.add(source.url);
      candidates.push(source);
    }
  }

  const downloadRe = /<a\b[^>]*href=["']([^"']*\/download\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const downloads: Array<{ url: string; hint: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = downloadRe.exec(html))) {
    const url = absolute(pageUrl, match[1]);
    if (!url || downloads.some((item) => item.url === url)) continue;
    const contextWindow = stripTags(
      html.slice(Math.max(0, match.index - 350), Math.min(html.length, match.index + 700)),
    );
    downloads.push({ url, hint: contextWindow });
  }

  for (const item of downloads.slice(0, 10)) {
    try {
      const head = await fetchWithTimeout(item.url, {
        method: 'HEAD',
        redirect: 'follow',
        timeoutMs,
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0; +https://movyza.app)',
          Referer: pageUrl,
        },
      });
      const contentType = (head.headers.get('content-type') || '').toLowerCase();
      const finalUrl = head.url || item.url;
      const finalClassified = classifyUrl(finalUrl, item.hint, true);

      if (contentType.startsWith('video/') || finalClassified?.type !== 'embed') {
        add(finalUrl, item.hint);
        continue;
      }

      if (/html|text/i.test(contentType)) {
        const page = await getText(finalUrl, timeoutMs, pageUrl);
        const nested = page.match(/<a\b[^>]*href=["']([^"']*\/download\/[^"']+)["'][^>]*>/i)?.[1];
        if (nested) {
          const nestedUrl = absolute(finalUrl, nested);
          if (nestedUrl && nestedUrl !== item.url) {
            const nestedHead = await fetchWithTimeout(nestedUrl, {
              method: 'HEAD',
              redirect: 'follow',
              timeoutMs,
              headers: {
                Accept: '*/*',
                'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0; +https://movyza.app)',
                Referer: finalUrl,
              },
            });
            add(nestedHead.url || nestedUrl, item.hint);
          }
        }
      }
    } catch {}
  }

  for (const node of parseJsonLdObjects(html)) {
    for (const key of ['contentUrl', 'url', 'embedUrl']) {
      const raw = node[key];
      if (typeof raw === 'string') add(raw, typeof node.name === 'string' ? node.name : '');
    }