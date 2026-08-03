/**
 * share-inbox receiver (spec 083 S1) — the team's pattern drop endpoint.
 *
 * Deployed ONCE by the admin as an Apps Script Web App (see DEPLOY.md). It runs under the ADMIN's
 * account and writes into an admin-owned Drive folder, so contributors need no Google auth, no
 * git, no setup — the Builder just POSTs {secret, slug, contributor, yaml, meta} to the /exec URL
 * committed in `.dify-share.json`.
 *
 * Layout it maintains under the configured root folder:
 *   inbox/YYYY-MM/<slug>--<contributor>--<yyyyMMdd-HHmmss>.yml        (the pattern)
 *   inbox/YYYY-MM/<slug>--<contributor>--<yyyyMMdd-HHmmss>.meta.json (verdicts for /shelf-inbox)
 *
 * Month folders use Asia/Tokyo explicitly — Apps Script defaults to UTC and would shift the date
 * for JP users (the same lesson as the schedule-trigger timezone bug).
 *
 * Script Properties (Project Settings → Script Properties):
 *   SECRET    — must match `.dify-share.json` `secret` (keeps non-repo strangers out; the admin
 *               gate at /shelf-inbox is the real quality gate)
 *   FOLDER_ID — Drive folder id of the inbox root (the part after /folders/ in its URL)
 *   MAX_KB    — optional upload cap, default 512
 */

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_({ ok: false, error: 'body is not JSON' });
    }
    if (!body || String(body.secret || '') !== String(props.getProperty('SECRET') || '__unset__')) {
      return json_({ ok: false, error: 'bad secret' });
    }
    if (typeof body.yaml !== 'string' || !body.yaml.trim()) {
      return json_({ ok: false, error: 'yaml (string) is required' });
    }
    var maxKb = Number(props.getProperty('MAX_KB')) > 0 ? Number(props.getProperty('MAX_KB')) : 512;
    if (Utilities.newBlob(body.yaml).getBytes().length > maxKb * 1024) {
      return json_({ ok: false, error: 'pattern exceeds the ' + maxKb + 'KB cap' });
    }
    var folderId = props.getProperty('FOLDER_ID');
    if (!folderId) return json_({ ok: false, error: 'receiver not configured (FOLDER_ID missing)' });

    var slug = sanitize_(body.slug, 'pattern');
    var contributor = sanitize_(body.contributor, 'anon');
    var now = new Date();
    var month = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
    var stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    var base = slug + '--' + contributor + '--' + stamp;

    var dir = getOrCreate_(getOrCreate_(DriveApp.getFolderById(folderId), 'inbox'), month);
    dir.createFile(base + '.yml', body.yaml, 'text/yaml');
    dir.createFile(base + '.meta.json', JSON.stringify(body.meta || {}, null, 2), 'application/json');
    return json_({ ok: true, path: 'inbox/' + month + '/' + base + '.yml' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Keep names filesystem/Drive-safe and short; empty/garbage input falls back. */
function sanitize_(s, fallback) {
  var out = String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return out || fallback;
}

function getOrCreate_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
