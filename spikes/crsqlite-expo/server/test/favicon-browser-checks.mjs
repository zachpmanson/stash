import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export async function faviconChecks({ evaluate, cdp, sessionId, responses, browserLogs, waitFor }) {
  assert.deepEqual(await evaluate(`(()=>{const links=[...document.querySelectorAll('link[rel=icon]')];return links.map(l=>({type:l.type,path:new URL(l.href).pathname}))})()`), [{ type: "image/svg+xml", path: "/assets/favicon.svg" }]);
  // Headless Chromium has no tab favicon loader. The headed Xvfb release fixture
  // requires Chromium's own request, before this test makes any image request.
  if (process.env.STASH_BROWSER_HEADED === "1") {
    await waitFor(() => responses.some(r => new URL(r.url).pathname === "/assets/favicon.svg" && r.status === 200));
    const response = responses.find(r => new URL(r.url).pathname === "/assets/favicon.svg" && r.status === 200);
    assert.equal(response.mimeType, "image/svg+xml");
  }
  const pixels = await evaluate(`(async()=>{
    const img=new Image(); img.src=document.querySelector('link[rel=icon]').href; await img.decode();
    const results=[];
    for(const size of [16,32,48]) {
      const c=document.createElement('canvas'); c.width=c.height=size; const ctx=c.getContext('2d');ctx.drawImage(img,0,0,size,size);
      const p=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
      results.push({size,corners:[p(0,0)[3],p(size-1,0)[3],p(0,size-1)[3],p(size-1,size-1)[3]],white:p(size/2,Math.floor(size*.12)),mark:p(Math.floor(size*.5),Math.floor(size*.41))});
    }
    return results;
  })()`);
  for (const p of pixels) {
    assert.deepEqual(p.corners, [0, 0, 0, 0]);
    assert.deepEqual(p.white, [255, 255, 255, 255]);
    assert.ok(p.mark[0] < 140, JSON.stringify(p));
  }
  assert.equal(browserLogs.filter(x => /content security policy|violat.*(?:img-src|favicon)/i.test(JSON.stringify(x))).length, 0, JSON.stringify(browserLogs));
  // Headless chrome has no tab strip. Same fetched icon at actual CSS sizes on
  // light/dark chrome-colour swatches; not owner/browser-chrome acceptance.
  await evaluate(`(()=>{
    const sheet=document.createElement('div');sheet.id='favicon-contact-sheet';Object.assign(sheet.style,{position:'fixed',inset:'0',zIndex:'99999',background:'white',fontFamily:'sans-serif',padding:'24px',color:'black'});
    for(const [label,bg,fg] of [['Light chrome swatch','#f1f3f4','#202124'],['Dark chrome swatch','#202124','#f1f3f4']]) {
      const row=document.createElement('div');Object.assign(row.style,{background:bg,color:fg,padding:'24px',marginBottom:'24px',display:'flex',alignItems:'center',gap:'32px'});
      const text=document.createElement('span');text.textContent=label;row.append(text);
      for(const size of [16,32,48]){const cell=document.createElement('div'); const img=new Image(size,size);img.src='/assets/favicon.svg';cell.append(img,document.createTextNode(' '+size+'px'));row.append(cell)}sheet.append(row);
    }
    document.body.append(sheet);
  })()`);
  await evaluate(`Promise.all([...document.querySelectorAll('#favicon-contact-sheet img')].map(i=>i.decode()))`);
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 780, height: 340, scale: 1 } }, sessionId);
  const artifact = process.env.STASH_FAVICON_PREVIEW ?? "/tmp/stash-favicon-preview.png";
  await writeFile(artifact, Buffer.from(screenshot.data, "base64"));
  await evaluate(`document.getElementById('favicon-contact-sheet').remove()`);
  console.log(`PASS Chromium SVG favicon load (automatic request asserted in headed mode), CSP, transparent corners/white circle/mark pixels 16/32/48px; preview ${artifact}`);
}
