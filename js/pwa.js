import { pendingOperations } from './sync.js';
import { node, action, finish } from './learning-ui.js';
let installPrompt,registration,applying=false,reloadAvailable=false;
const signal=()=>window.dispatchEvent(new Event('pwa-ready'));
async function applyUpdate(section){
 if((await pendingOperations()).length){section.append(node('p','Sync pending changes before updating.'));return;}
 if(!registration?.waiting){if(reloadAvailable)location.reload();return;}
 applying=true;
 registration.waiting.postMessage({type:'APPLY_UPDATE'});
 section.append(node('p','Updating app… Please wait.'));
}
function showUpdate(){
 let banner=document.getElementById('pwa-update-banner');
 if(!registration?.waiting&&!reloadAvailable){banner?.remove();return;}
 if(!banner){banner=node('div','','feedback pwa-update-banner');banner.id='pwa-update-banner';banner.setAttribute('role','status');document.getElementById('main')?.before(banner);}
 banner.replaceChildren(node('span','A new app version is ready.'),action('Update app',()=>applyUpdate(banner),true));
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;signal();});
export async function initializePwa(){
 if(!('serviceWorker'in navigator))return;
 registration=await navigator.serviceWorker.register(new URL('../service-worker.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname,updateViaCache:'none'});
 const updated=()=>{showUpdate();signal();};
 let hadController=!!navigator.serviceWorker.controller;
 registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',updated));
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applying){applying=false;location.reload();}else{reloadAvailable=hadController;hadController=true;updated();}});
 updated();
 registration.update().catch(()=>{});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')registration.update().catch(()=>{});});
 return registration;
}
export function pwaSettings(){
 const section=node('section','','card settings-card');section.append(node('h2','Install Arabic Journey'),node('p','App release: 2026-10-05 · Admin approval'));
 if(installPrompt)section.append(action('Install app',async()=>{await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;signal();}));
 else section.append(node('p','Use your browser menu to install. On iPhone: Share → Add to Home Screen.'));
 section.append(action('Check for updates',async()=>{try{await registration?.update();showUpdate();if(registration?.waiting)signal();if(!registration?.waiting&&!registration?.installing&&!reloadAvailable)section.append(node('p','No update found. You are using the current app version.'));}catch{section.append(node('p','Could not check for updates. Check your connection.'));}}));
 if(registration?.waiting||reloadAvailable)section.append(action('Update app',()=>applyUpdate(section),true));
 return finish(section);
}
