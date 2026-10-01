const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});
 try {
  await win.loadURL('http://127.0.0.1:5174/test/satin-preview.html');
  const result=await win.webContents.executeJavaScript('window.result');
  if(!result)throw Error('Preview checks did not finish; inspect test page');
  fs.writeFileSync('demo-assets/satin-before-after.png',Buffer.from(result.image,'base64'));
  fs.writeFileSync('demo-assets/satin-samples.png',Buffer.from(result.sample,'base64'));
  fs.writeFileSync('demo-assets/satin-detail.png',Buffer.from(result.detail,'base64'));
  console.log(JSON.stringify({checks:result.checks,renderMs:Math.round(result.elapsed),diagonalMs:Math.round(result.diagonalMs)})); app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
