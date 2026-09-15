const fs=require('fs');
const path=require('path');
const appPath=path.join(__dirname,'public','app.js');
const extPath=path.join(__dirname,'public','permissions.js');
try{
  let core=fs.readFileSync(appPath,'utf8');
  const ext=fs.readFileSync(extPath,'utf8');
  const marker='/* CROSSCERT_PERMISSION_EXTENSION */';
  if(!core.includes(marker))fs.writeFileSync(appPath,core+'\n'+marker+'\n'+ext+'\n','utf8');
  console.log('Granular permission UI enabled');
}catch(e){console.error('Permission UI injection failed',e);process.exit(1)}
require('./server.js');