// graphics/<이름>.html 의 #cv 상자를 이미지로 만든다.
//   node graphics/render.js <이름> [<이름> ...]      예) node graphics/render.js card-a
//   결과: img/g-<이름>.webp (사이트용, 3배 해상도)  +  graphics/_preview/<이름>.png (눈으로 확인용, 2배)
// Edge(headless)를 CDP 로 조종한다. 글꼴(Pretendard)은 CDN 에서 받으므로 인터넷이 필요하다.
const {spawn} = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Edge 를 찾지 못했습니다'); process.exit(1); }
const names = process.argv.slice(2);
if (!names.length) { console.error('사용법: node graphics/render.js <이름> ...'); process.exit(1); }
fs.mkdirSync(path.join(ROOT, 'graphics', '_preview'), {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9400 + Math.floor(Math.random() * 400);

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-edge-'));
  const br = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files', 'about:blank'], {stdio: 'ignore'});
  let list;
  for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find(t => t.type === 'page')) break; } catch (e) {} await sleep(200); }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}, waiters = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } else if (m.method) waiters.forEach(w => w(m)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
  const once = name => new Promise(r => { const w = m => { if (m.method === name) { waiters.splice(waiters.indexOf(w), 1); r(m); } }; waiters.push(w); });
  const ev = async e => { const r = await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true}); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  let fail = 0;
  for (const name of names) {
    const src = path.join(ROOT, 'graphics', name + '.html');
    if (!fs.existsSync(src)) { console.error('없음: ' + src); fail++; continue; }
    await send('Emulation.setDeviceMetricsOverride', {width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false});
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', {url: 'file:///' + src.replace(/\\/g, '/')});
    await loaded;
    // 글꼴: 쓰는 굵기를 모두 불러온 뒤 한 번 더 기다린다
    await ev(`(async()=>{const t=document.body.innerText||'';for(const w of [400,500,600,700,800,900])await document.fonts.load(w+' 20px "Pretendard Variable"',t);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>setTimeout(r,500));return 1})()`);
    const box = JSON.parse(await ev(`(()=>{const e=document.getElementById('cv');if(!e)return JSON.stringify({err:'#cv 가 없습니다'});const r=e.getBoundingClientRect();return JSON.stringify({x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height,fonts:document.fonts.check('900 20px "Pretendard Variable"')})})()`));
    if (box.err) { console.error(name + ': ' + box.err); fail++; continue; }
    if (!box.fonts) console.warn(name + ': 경고 - Pretendard 글꼴이 로드되지 않았습니다(인터넷 연결 확인)');
    // <meta name="gfx-scale" content="1"> 로 사이트용 해상도 배율을 바꾼다(기본 3). 사진 합성처럼 큰 이미지는 1 또는 2
    const meta = n => { const m = fs.readFileSync(src, 'utf8').match(new RegExp('<meta\\s+name="' + n + '"\\s+content="([^"]+)"')); return m ? +m[1] : null; };
    const SC = meta('gfx-scale') || 3, Q = meta('gfx-quality') || 90;
    const clip = s => ({x: box.x, y: box.y, width: box.w, height: box.h, scale: s});
    const web = await send('Page.captureScreenshot', {format: 'webp', quality: Q, captureBeyondViewport: true, clip: clip(SC)});
    const png = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: clip(2)});
    const out = path.join(ROOT, 'img', 'g-' + name + '.webp');
    fs.writeFileSync(out, Buffer.from(web.result.data, 'base64'));
    fs.writeFileSync(path.join(ROOT, 'graphics', '_preview', name + '.png'), Buffer.from(png.result.data, 'base64'));
    console.log(`${name}: ${Math.round(box.w)}x${Math.round(box.h)} css px -> img/g-${name}.webp (${Math.round(fs.statSync(out).size / 1024)}KB)`);
  }
  ws.close(); br.kill();
  try { fs.rmSync(prof, {recursive: true, force: true}); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
