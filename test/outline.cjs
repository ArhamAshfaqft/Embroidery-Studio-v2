const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});
 try {
  await win.loadURL('http://127.0.0.1:5174/test/outline.html');
  const r=await win.webContents.executeJavaScript('window.done');
  if(!r)throw Error('Missing test result');
  fs.writeFileSync('demo-assets/outline-comparison.png',Buffer.from(r.image,'base64'));
  fs.writeFileSync('demo-assets/outline-sample.png',Buffer.from(r.sample,'base64'));
  console.log(JSON.stringify({checks:r.checks}));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
