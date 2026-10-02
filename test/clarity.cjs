const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});
 try {
  await win.loadURL('http://127.0.0.1:5174/test/clarity.html');
  const r=await win.webContents.executeJavaScript('window.done');
  if(!r)throw Error('Missing test result');
  fs.writeFileSync('demo-assets/satin-zoom-clarity.png',Buffer.from(r.image,'base64'));
  delete r.image;console.log(JSON.stringify(r));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
