const fs = require('fs');

const titles = [
    'Flowork OS Tools Serba Bisa buat Content Creator, Affiliator, Team Seo',
    'Cara Install Extensi Chrome Untuk FLowork OS',
    'Cara Bongkar Algoritma TikTok Pake Flowork OS TikTok Deepscan',
    'Trik Rahasia Jadi Shopee Affiliator Tanpa Beli Sample Produk pake tools Flowork OS',
    'Bongkar Rahasia Video Kompetitor Agar Video Kita Naik Pake YT DeepScan dari floworkos',
    'Bongkar Trafik Website Competitor Dengat Tools Dari Flowork OS',
    'FLOWORK OS BRIDGE'
];

async function run() {
    for (let title of titles) {
        const u = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(title);
        try {
            const h = await fetch(u, {headers: {'User-Agent': 'Mozilla/5.0'}}).then(r=>r.text());
            const regex = /"videoId":"([a-zA-Z0-9_-]{11})"/;
            const m = h.match(regex);
            if (m) console.log(title + ' => ' + m[1]);
            else console.log(title + ' => Not Found');
        } catch (e) {
            console.log(title + ' => Error: ' + e.message);
        }
    }
}
run();
