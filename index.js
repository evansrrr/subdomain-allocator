var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Token"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (path === "/api/domains" && request.method === "GET") {
      let domains = [];
      try {
        domains = JSON.parse(env.MAIN_DOMAINS || "[]");
      } catch (e) {
      }
      return new Response(JSON.stringify({ domains }), { headers: corsHeaders });
    }
    if (path === "/api/send-code" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      const email = body.email;
      if (!email || !email.endsWith(env.ALLOWED_EMAIL_SUFFIX)) {
        return new Response(JSON.stringify({ error: "\u4EC5\u5141\u8BB8\u7279\u5B9A\u90AE\u7BB1\u540E\u7F00" }), { status: 400, headers: corsHeaders });
      }
      const code = Math.floor(1e5 + Math.random() * 9e5).toString();
      await env.KV.put(`code:${email}`, JSON.stringify({ code, expires: Date.now() + 6e5 }), { expirationTtl: 600 });
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: email,
            subject: "\u60A8\u7684\u5B50\u57DF\u540D\u9A8C\u8BC1\u7801",
            html: `<h2>\u9A8C\u8BC1\u7801\uFF1A${code}</h2><p>\u6B64\u9A8C\u8BC1\u7801 10 \u5206\u949F\u5185\u6709\u6548\uFF0C\u8BF7\u52FF\u6CC4\u9732\u3002</p><p>\u2014\u2014 \u5B50\u57DF\u540D\u5206\u914D\u5668</p>`
          })
        });
      } catch (e) {
        console.error("\u90AE\u4EF6\u53D1\u9001\u5931\u8D25:", e);
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }
    if (path === "/api/verify-code" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      const email = body.email;
      const code = body.code;
      const dataStr = await env.KV.get(`code:${email}`);
      if (!dataStr) return new Response(JSON.stringify({ error: "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\u6216\u4E0D\u5B58\u5728" }), { status: 400, headers: corsHeaders });
      const saved = JSON.parse(dataStr);
      if (Date.now() > saved.expires || code !== saved.code) {
        return new Response(JSON.stringify({ error: "\u9A8C\u8BC1\u7801\u9519\u8BEF" }), { status: 400, headers: corsHeaders });
      }
      await env.KV.delete(`code:${email}`);
      await env.DB.prepare("INSERT OR IGNORE INTO users (email) VALUES (?)").bind(email).run();
      const expires = Date.now() + 24 * 60 * 60 * 1e3;
      const token2 = btoa(`${email}|${expires}`);
      return new Response(JSON.stringify({ success: true, token: token2, email }), { headers: corsHeaders });
    }
    const token = request.headers.get("X-User-Token");
    let userEmail = null;
    if (token) {
      try {
        const decoded = atob(token);
        const parts = decoded.split("|");
        if (Date.now() <= parseInt(parts[1])) userEmail = parts[0];
      } catch {
      }
    }
    if (!userEmail) {
      return new Response(JSON.stringify({ error: "\u672A\u767B\u5F55\u6216Token\u5DF2\u8FC7\u671F" }), { status: 401, headers: corsHeaders });
    }
    if (path === "/api/records" && request.method === "GET") {
      const recordsResult = await env.DB.prepare("SELECT * FROM records WHERE email = ? ORDER BY created_at DESC").bind(userEmail).all();
      const userResult = await env.DB.prepare("SELECT used_records FROM users WHERE email = ?").bind(userEmail).first();
      const used = userResult && userResult.used_records ? userResult.used_records : 0;
      const max = parseInt(env.MAX_RECORDS_PER_USER || "5");
      return new Response(JSON.stringify({ records: recordsResult.results || [], used, max }), { headers: corsHeaders });
    }
    if (path === "/api/records" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      const subdomain = body.subdomain;
      const main_domain = body.main_domain;
      const target = body.target;
      if (!subdomain || !main_domain || !target) {
        return new Response(JSON.stringify({ error: "\u53C2\u6570\u4E0D\u5B8C\u6574" }), { status: 400, headers: corsHeaders });
      }
      const userResult = await env.DB.prepare("SELECT used_records FROM users WHERE email = ?").bind(userEmail).first();
      const used = userResult && userResult.used_records ? userResult.used_records : 0;
      const max = parseInt(env.MAX_RECORDS_PER_USER || "5");
      if (used >= max) {
        return new Response(JSON.stringify({ error: "\u5DF2\u8FBE\u5230\u914D\u989D\u4E0A\u9650" }), { status: 400, headers: corsHeaders });
      }
      const zoneMap = JSON.parse(env.CLOUDFLARE_ZONE_MAP || "{}");
      const zoneId = zoneMap[main_domain];
      if (!zoneId) {
        return new Response(JSON.stringify({ error: "\u4E0D\u652F\u6301\u8BE5\u4E3B\u57DF\u540D" }), { status: 400, headers: corsHeaders });
      }
      const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CNAME", name: `${subdomain}.${main_domain}`, content: target, proxied: true, ttl: 1 })
      });
      const dnsJson = await dnsRes.json();
      if (!dnsJson.success) {
        return new Response(JSON.stringify({ error: "DNS\u8BB0\u5F55\u521B\u5EFA\u5931\u8D25", detail: dnsJson.errors || "\u672A\u77E5\u9519\u8BEF" }), { status: 400, headers: corsHeaders });
      }
      await env.DB.prepare("INSERT INTO records (email, subdomain, main_domain, target) VALUES (?, ?, ?, ?)").bind(userEmail, subdomain, main_domain, target).run();
      await env.DB.prepare("UPDATE users SET used_records = used_records + 1 WHERE email = ?").bind(userEmail).run();
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }
    if (path.startsWith("/api/records/") && request.method === "DELETE") {
      const id = path.split("/").pop();
      const record = await env.DB.prepare("SELECT * FROM records WHERE id = ? AND email = ?").bind(id, userEmail).first();
      if (!record) return new Response(JSON.stringify({ error: "\u8BB0\u5F55\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u9650" }), { status: 404, headers: corsHeaders });
      const zoneMap = JSON.parse(env.CLOUDFLARE_ZONE_MAP || "{}");
      const zoneId = zoneMap[record.main_domain];
      if (zoneId) {
        try {
          const listRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=CNAME&name=${record.subdomain}.${record.main_domain}`, {
            headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
          });
          const listJson = await listRes.json();
          const dnsRecordId = listJson.result && listJson.result.length > 0 ? listJson.result[0].id : null;
          if (dnsRecordId) {
            await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${dnsRecordId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
            });
          }
        } catch (e) {
          console.error("\u5220\u9664 DNS \u5931\u8D25:", e);
        }
      }
      await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
      await env.DB.prepare("UPDATE users SET used_records = used_records - 1 WHERE email = ?").bind(userEmail).run();
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
export {
  index_default as default
};