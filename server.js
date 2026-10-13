import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';

const app=express(); app.use(express.json());
app.use(express.static('admin'));
const PORT=process.env.PORT||3000;
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'CHANGE-ME';
const DB='./licenses.json';
let db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB,'utf8')):{licenses:{}};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db,null,2));
const auth=(req,res,next)=>{if(req.get('authorization')!==`Bearer ${ADMIN_TOKEN}`)return res.status(401).json({message:'Unauthorized'});next()};
const addDays=(iso,n)=>{const d=new Date(iso);d.setUTCDate(d.getUTCDate()+n);return d.toISOString()};
const planDays={30:30,60:60,90:90};
const prices={30:2199,60:3999,90:5199};
const adminDir=new URL('./admin/', import.meta.url);


app.get('/health',(req,res)=>res.json({ok:true,service:'VisaSlot Pro License Server'}));
app.post('/v1/license/activate',(req,res)=>{
  const {licenseKey,installationId,extensionVersion}=req.body||{};
  const l=db.licenses[licenseKey];
  if(!l)return res.status(404).json({active:false,message:'Invalid license key.'});
  if(l.status!=='ACTIVE')return res.status(403).json({active:false,message:`License is ${l.status.toLowerCase()}.`});
  if(new Date(l.expiresAt)<=new Date())return res.status(403).json({active:false,message:'License expired.'});
  if(!l.installationId) {l.installationId=installationId;l.lastSeenAt=new Date().toISOString();l.extensionVersion=extensionVersion;save();}
  else if(l.installationId!==installationId) return res.status(409).json({active:false,message:'Device limit reached. Request a device transfer.'});
  l.lastSeenAt=new Date().toISOString();l.extensionVersion=extensionVersion;save();
  res.json({active:true,plan:l.plan,expiresAt:l.expiresAt.slice(0,10),status:l.status});
});
app.post('/v1/license/heartbeat',(req,res)=>{
  const {licenseKey,installationId}=req.body||{}; const l=db.licenses[licenseKey];
  if(!l||l.status!=='ACTIVE'||l.installationId!==installationId||new Date(l.expiresAt)<=new Date())return res.status(403).json({active:false,message:'License inactive.'});
  l.lastSeenAt=new Date().toISOString();save();res.json({active:true,expiresAt:l.expiresAt.slice(0,10),plan:l.plan});
});
app.get('/admin/licenses',auth,(req,res)=>res.json(Object.values(db.licenses)));
app.post('/admin/licenses',auth,(req,res)=>{
  const days=Number(req.body?.days); if(!planDays[days])return res.status(400).json({message:'days must be 30, 60 or 90'});
  const key='VSP-'+crypto.randomBytes(4).toString('hex').toUpperCase()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
  const now=new Date(); const customer=String(req.body?.customer||'').trim(); const email=String(req.body?.email||'').trim();
  const l={licenseKey:key,plan:`${days}-Day`,days,priceINR:prices[days],customer,email,status:'ACTIVE',createdAt:now.toISOString(),activatedAt:null,expiresAt:addDays(now.toISOString(),days),installationId:null,lastSeenAt:null,extensionVersion:null,transferAvailableAt:now.toISOString()};
  db.licenses[key]=l;save();res.json(l);
});
app.post('/admin/licenses/:key/status',auth,(req,res)=>{const l=db.licenses[req.params.key];if(!l)return res.status(404).json({message:'Not found'});if(!['ACTIVE','SUSPENDED','REVOKED'].includes(req.body?.status))return res.status(400).json({message:'Invalid status'});l.status=req.body.status;save();res.json(l)});

app.post('/admin/licenses/:key/renew',auth,(req,res)=>{
  const l=db.licenses[req.params.key]; if(!l)return res.status(404).json({message:'Not found'});
  const days=Number(req.body?.days||l.days); if(!planDays[days])return res.status(400).json({message:'days must be 30, 60 or 90'});
  const now=new Date(); const base=new Date(l.expiresAt)>now?new Date(l.expiresAt):now;
  l.days=days; l.plan=`${days}-Day`; l.priceINR=prices[days]; l.expiresAt=addDays(base.toISOString(),days); l.status='ACTIVE'; save(); res.json(l);
});
app.post('/admin/licenses/:key/reset-device',auth,(req,res)=>{
  const l=db.licenses[req.params.key]; if(!l)return res.status(404).json({message:'Not found'});
  l.installationId=null; l.transferAvailableAt=new Date().toISOString(); save(); res.json(l);
});

app.post('/admin/licenses/:key/transfer',auth,(req,res)=>{const l=db.licenses[req.params.key];if(!l)return res.status(404).json({message:'Not found'});const now=new Date();if(new Date(l.transferAvailableAt)>now)return res.status(409).json({message:`Transfer available after ${l.transferAvailableAt.slice(0,10)}`});l.installationId=null;l.transferAvailableAt=addDays(now.toISOString(),30);save();res.json({ok:true,license:l})});
app.listen(PORT,()=>console.log(`VisaSlot Pro license server listening on :${PORT}`));
