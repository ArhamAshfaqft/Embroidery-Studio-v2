const {app,BrowserWindow}=require('electron');const fs=require('node:fs');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const timer=setTimeout(()=>{console.error('Rendering test timed out');app.exit(1);},60000);
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,_l,message)=>console.log(message));
 try{
 await win.loadURL('http://127.0.0.1:5174/test/sew-quality.html');console.log('Test page loaded');
 const r=await win.webContents.executeJavaScript('window.done');
 fs.writeFileSync('demo-assets/mockup-quality-comparison.png',Buffer.from(r.image,'base64'));
 fs.writeFileSync('demo-assets/mockup-quality.png',Buffer.from(r.mockup,'base64'));
 delete r.image;delete r.mockup;console.log(JSON.stringify(r));clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);clearTimeout(timer);app.exit(1);}
});
