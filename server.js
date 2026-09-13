const express=require('express');
const cookieParser=require('cookie-parser');
const jwt=require('jsonwebtoken');
const {OAuth2Client}=require('google-auth-library');
const {Pool}=require('pg');
const path=require('path');

const app=express();
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());

const PORT=process.env.PORT||3000;
const GOOGLE_CLIENT_ID=process.env.GOOGLE_CLIENT_ID||'';
const ALLOWED_DOMAIN=process.env.ALLOWED_DOMAIN||'crosscert.com';
const SESSION_SECRET=process.env.SESSION_SECRET||'CHANGE_ME';
const BOOTSTRAP_HR_EMAIL=(process.env.BOOTSTRAP_HR_EMAIL||'dhlee1@crosscert.com').toLowerCase();

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL&&process.env.DATABASE_URL.includes('railway')?{rejectUnauthorized:false}:undefined
});
const googleClient=new OAuth2Client(GOOGLE_CLIENT_ID);

function koreaDate(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function signSession(u){
  return jwt.sign({id:u.id,email:u.email,name:u.name,role:u.role,dept:u.dept,team:u.team},SESSION_SECRET,{expiresIn:'12h'});
}
function auth(req,res,next){
  try{
    const t=req.cookies.wfh_session;
    if(!t)return res.status(401).json({error:'로그인이 필요합니다.'});
    req.user=jwt.verify(t,SESSION_SECRET); next();
  }catch(e){res.status(401).json({error:'세션이 만료되었습니다.'});}
}
function requireRole(...roles){return(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'권한이 없습니다.'});}
async function audit(email,action,target='',detail={}){
  try{await pool.query('insert into audit_logs(actor_email,action,target,detail) values($1,$2,$3,$4)',[email,action,target,detail]);}catch(e){}
}
async function visibleIds(u){
  if(u.role==='hr'){
    const r=await pool.query('select id from app_users where active=true'); return r.rows.map(x=>x.id);
  }
  if(u.role==='manager'){
    const r=await pool.query('select id from app_users where active=true and (lower(manager_email)=lower($1) or lower(email)=lower($1))',[u.email]); return r.rows.map(x=>x.id);
  }
  return [u.id];
}

async function initDb(){
  await pool.query(`
  create table if not exists app_users(
    id bigserial primary key,
    email text unique not null,
    name text not null,
    dept text default '',
    role text not null default 'employee' check(role in('hr','manager','employee')),
    manager_email text default '',
    team text default '',
    head text default '',
    wfh_type text default '일반',
    approval_start date,
    approval_end date,
    wfh_status text not null default 'active',
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  alter table app_users add column if not exists head text default '';
  alter table app_users add column if not exists wfh_type text default '일반';
  alter table app_users add column if not exists approval_start date;
  alter table app_users add column if not exists approval_end date;
  alter table app_users add column if not exists wfh_status text not null default 'active';

  create table if not exists work_logs(
    id bigserial primary key,
    user_id bigint not null references app_users(id) on delete cascade,
    work_date date not null,
    clock_in timestamptz,
    clock_out timestamptz,
    plan text default '',
    completed text default '',
    ongoing text default '',
    next_plan text default '',
    am_check text default '',
    pm_check text default '',
    mid_progress text default '',
    completion_rate integer default 0,
    availability text default '연락가능',
    evidence text default '',
    delay_reason text default '',
    dept_profile text default '',
    work_count integer default 0,
    dept_evidence text default '',
    remarks text default '',
    approved boolean not null default false,
    approved_by text default '',
    approved_at timestamptz,
    updated_at timestamptz not null default now(),
    unique(user_id,work_date)
  );

  create table if not exists activity_daily(
    id bigserial primary key,
    user_id bigint not null references app_users(id) on delete cascade,
    work_date date not null,
    active_seconds integer not null default 0,
    idle_seconds integer not null default 0,
    hidden_seconds integer not null default 0,
    idle_events integer not null default 0,
    long_idle_events integer not null default 0,
    interactions integer not null default 0,
    last_activity timestamptz,
    last_heartbeat timestamptz,
    updated_at timestamptz not null default now(),
    unique(user_id,work_date)
  );

  create table if not exists risk_actions(
    user_id bigint primary key references app_users(id) on delete cascade,
    status text not null default 'open',
    note text default '',
    next_check date,
    updated_by text default '',
    updated_at timestamptz not null default now()
  );

  create table if not exists app_settings(
    id integer primary key default 1,
    std_in text not null default '09:00',
    late_at text not null default '09:10',
    std_out text not null default '18:00',
    min_text integer not null default 20,
    idle_minutes integer not null default 15,
    long_idle_minutes integer not null default 30,
    updated_at timestamptz not null default now()
  );
  insert into app_settings(id) values(1) on conflict(id) do nothing;

  create table if not exists audit_logs(
    id bigserial primary key,
    actor_email text not null,
    action text not null,
    target text default '',
    detail jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  `);
}

app.get('/health',(req,res)=>res.json({ok:true,version:'11.1'}));

app.post('/api/auth/google',async(req,res)=>{
  try{
    const credential=req.body?.credential;
    if(!credential)return res.status(400).json({error:'Google 인증정보가 없습니다.'});
    const ticket=await googleClient.verifyIdToken({idToken:credential,audience:GOOGLE_CLIENT_ID});
    const p=ticket.getPayload(), email=(p.email||'').toLowerCase(), hd=(p.hd||'').toLowerCase();
    if(!email.endsWith('@'+ALLOWED_DOMAIN)||(hd&&hd!==ALLOWED_DOMAIN))return res.status(403).json({error:'회사 Google Workspace 계정만 사용할 수 있습니다.'});
    let q=await pool.query('select * from app_users where lower(email)=lower($1)',[email]);
    if(!q.rowCount&&email===BOOTSTRAP_HR_EMAIL){
      q=await pool.query(`insert into app_users(email,name,dept,role,team,head,wfh_type,wfh_status,active)
      values($1,$2,'인사팀','hr','HR','', '관리자','active',true) returning *`,[email,p.name||'HR']);
    }
    if(!q.rowCount)return res.status(403).json({error:'등록되지 않은 계정입니다. HR 관리자에게 등록을 요청하세요.'});
    const u=q.rows[0]; if(!u.active)return res.status(403).json({error:'비활성화된 계정입니다.'});
    res.cookie('wfh_session',signSession(u),{httpOnly:true,secure:true,sameSite:'lax',maxAge:12*60*60*1000});
    await audit(email,'LOGIN',email);
    res.json({ok:true});
  }catch(e){console.error(e);res.status(401).json({error:'Google 로그인 검증에 실패했습니다.'});}
});
app.post('/api/logout',auth,async(req,res)=>{await audit(req.user.email,'LOGOUT',req.user.email);res.clearCookie('wfh_session');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user,today:koreaDate()}));

app.get('/api/settings',auth,async(req,res)=>{const r=await pool.query('select * from app_settings where id=1');res.json(r.rows[0]);});
app.put('/api/settings',auth,requireRole('hr'),async(req,res)=>{
  const b=req.body||{};
  if(+b.long_idle_minutes<=+b.idle_minutes)return res.status(400).json({error:'장시간 공백 기준은 자리비움 기준보다 길어야 합니다.'});
  const r=await pool.query(`update app_settings set std_in=$1,late_at=$2,std_out=$3,min_text=$4,idle_minutes=$5,long_idle_minutes=$6,updated_at=now() where id=1 returning *`,
  [b.std_in||'09:00',b.late_at||'09:10',b.std_out||'18:00',+b.min_text||20,+b.idle_minutes||15,+b.long_idle_minutes||30]);
  await audit(req.user.email,'UPDATE_SETTINGS','app_settings',b);res.json(r.rows[0]);
});

app.get('/api/users',auth,async(req,res)=>{
  let r;
  if(req.user.role==='employee')r=await pool.query(`select id,email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active from app_users where id=$1`,[req.user.id]);
  else if(req.user.role==='manager')r=await pool.query(`select id,email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active from app_users where active=true and (lower(manager_email)=lower($1) or lower(email)=lower($1)) order by dept,name`,[req.user.email]);
  else r=await pool.query(`select id,email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active from app_users order by active desc,dept,name`);
  res.json(r.rows);
});
app.post('/api/users',auth,requireRole('hr'),async(req,res)=>{
  const b=req.body||{};
  if(!b.email||!b.name)return res.status(400).json({error:'이메일과 이름은 필수입니다.'});
  if(!String(b.email).toLowerCase().endsWith('@'+ALLOWED_DOMAIN))return res.status(400).json({error:'회사 이메일만 등록할 수 있습니다.'});
  const r=await pool.query(`insert into app_users(email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active)
  values(lower($1),$2,$3,$4,lower($5),$6,$7,$8,$9,$10,$11,true)
  on conflict(email) do update set name=excluded.name,dept=excluded.dept,role=excluded.role,manager_email=excluded.manager_email,team=excluded.team,
  head=excluded.head,wfh_type=excluded.wfh_type,approval_start=excluded.approval_start,approval_end=excluded.approval_end,wfh_status=excluded.wfh_status,active=true,updated_at=now()
  returning id,email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active`,
  [b.email,b.name,b.dept||'',b.role||'employee',b.manager_email||'',b.team||'',b.head||'',b.wfh_type||'일반',b.approval_start||null,b.approval_end||null,b.wfh_status||'active']);
  await audit(req.user.email,'UPSERT_USER',b.email,b);res.json(r.rows[0]);
});
app.patch('/api/users/:id',auth,requireRole('hr'),async(req,res)=>{
  const b=req.body||{};
  const r=await pool.query(`update app_users set name=coalesce($1,name),dept=coalesce($2,dept),role=coalesce($3,role),manager_email=coalesce($4,manager_email),
  team=coalesce($5,team),head=coalesce($6,head),wfh_type=coalesce($7,wfh_type),approval_start=coalesce($8,approval_start),approval_end=coalesce($9,approval_end),
  wfh_status=coalesce($10,wfh_status),active=coalesce($11,active),updated_at=now() where id=$12 returning id,email,name,dept,role,manager_email,team,head,wfh_type,approval_start,approval_end,wfh_status,active`,
  [b.name??null,b.dept??null,b.role??null,b.manager_email??null,b.team??null,b.head??null,b.wfh_type??null,b.approval_start??null,b.approval_end??null,b.wfh_status??null,b.active??null,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:'사용자를 찾을 수 없습니다.'});
  await audit(req.user.email,'UPDATE_USER',String(req.params.id),b);res.json(r.rows[0]);
});

app.get('/api/logs',auth,async(req,res)=>{
  const ids=await visibleIds(req.user); if(!ids.length)return res.json([]);
  const from=req.query.from||req.query.date||koreaDate(), to=req.query.to||req.query.date||from;
  const r=await pool.query(`select l.*,u.email,u.name,u.dept,u.role,u.manager_email,u.team,u.head,u.wfh_type,u.approval_start,u.approval_end,u.wfh_status
  from work_logs l join app_users u on u.id=l.user_id
  where l.user_id=any($1::bigint[]) and l.work_date between $2 and $3 order by l.work_date desc,u.dept,u.name`,[ids,from,to]);
  res.json(r.rows);
});
app.post('/api/logs/today',auth,async(req,res)=>{
  const b=req.body||{},date=koreaDate();
  const r=await pool.query(`insert into work_logs(user_id,work_date,plan,completed,ongoing,next_plan,am_check,pm_check,mid_progress,completion_rate,availability,evidence,delay_reason,dept_profile,work_count,dept_evidence,remarks,updated_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
  on conflict(user_id,work_date) do update set plan=excluded.plan,completed=excluded.completed,ongoing=excluded.ongoing,next_plan=excluded.next_plan,am_check=excluded.am_check,pm_check=excluded.pm_check,mid_progress=excluded.mid_progress,
  completion_rate=excluded.completion_rate,availability=excluded.availability,evidence=excluded.evidence,delay_reason=excluded.delay_reason,dept_profile=excluded.dept_profile,work_count=excluded.work_count,dept_evidence=excluded.dept_evidence,remarks=excluded.remarks,updated_at=now()
  returning *`,
  [req.user.id,date,b.plan||'',b.completed||'',b.ongoing||'',b.next_plan||'',b.am_check||'',b.pm_check||'',b.mid_progress||'',Math.max(0,Math.min(100,+b.completion_rate||0)),b.availability||'연락가능',b.evidence||'',b.delay_reason||'',b.dept_profile||'',Math.max(0,+b.work_count||0),b.dept_evidence||'',b.remarks||'']);
  res.json(r.rows[0]);
});
app.post('/api/clock-in',auth,async(req,res)=>{
  const d=koreaDate();
  const r=await pool.query(`insert into work_logs(user_id,work_date,clock_in) values($1,$2,now())
  on conflict(user_id,work_date) do update set clock_in=coalesce(work_logs.clock_in,now()),updated_at=now() returning *`,[req.user.id,d]);
  await audit(req.user.email,'CLOCK_IN',d);res.json(r.rows[0]);
});
app.post('/api/clock-out',auth,async(req,res)=>{
  const d=koreaDate();
  const r=await pool.query(`update work_logs set clock_out=now(),updated_at=now() where user_id=$1 and work_date=$2 returning *`,[req.user.id,d]);
  await audit(req.user.email,'CLOCK_OUT',d);res.json(r.rows[0]||null);
});
app.post('/api/logs/:id/approve',auth,requireRole('hr','manager'),async(req,res)=>{
  const ids=await visibleIds(req.user);
  const r=await pool.query(`update work_logs set approved=true,approved_by=$1,approved_at=now(),updated_at=now()
  where id=$2 and user_id=any($3::bigint[]) returning *`,[req.user.email,req.params.id,ids]);
  if(!r.rowCount)return res.status(403).json({error:'승인할 수 없는 일지입니다.'});
  await audit(req.user.email,'APPROVE_LOG',String(req.params.id));res.json(r.rows[0]);
});

app.get('/api/activity',auth,async(req,res)=>{
  const ids=await visibleIds(req.user); if(!ids.length)return res.json([]);
  const date=req.query.date||koreaDate();
  const r=await pool.query(`select a.*,u.email,u.name,u.dept,u.role,u.manager_email,u.team
  from activity_daily a join app_users u on u.id=a.user_id where a.work_date=$1 and a.user_id=any($2::bigint[]) order by u.dept,u.name`,[date,ids]);
  res.json(r.rows);
});
app.post('/api/activity/heartbeat',auth,async(req,res)=>{
  const d=koreaDate();
  const wl=await pool.query('select clock_in,clock_out from work_logs where user_id=$1 and work_date=$2',[req.user.id,d]);
  if(!wl.rowCount||!wl.rows[0].clock_in||wl.rows[0].clock_out)return res.json({ignored:true});
  const b=req.body||{};
  const r=await pool.query(`insert into activity_daily(user_id,work_date,active_seconds,idle_seconds,hidden_seconds,idle_events,long_idle_events,interactions,last_activity,last_heartbeat,updated_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
  on conflict(user_id,work_date) do update set active_seconds=activity_daily.active_seconds+excluded.active_seconds,idle_seconds=activity_daily.idle_seconds+excluded.idle_seconds,
  hidden_seconds=activity_daily.hidden_seconds+excluded.hidden_seconds,idle_events=activity_daily.idle_events+excluded.idle_events,long_idle_events=activity_daily.long_idle_events+excluded.long_idle_events,
  interactions=activity_daily.interactions+excluded.interactions,last_activity=coalesce(excluded.last_activity,activity_daily.last_activity),last_heartbeat=now(),updated_at=now() returning *`,
  [req.user.id,d,Math.max(0,+b.active_seconds||0),Math.max(0,+b.idle_seconds||0),Math.max(0,+b.hidden_seconds||0),Math.max(0,+b.idle_events||0),Math.max(0,+b.long_idle_events||0),Math.max(0,+b.interactions||0),b.last_activity||null]);
  res.json(r.rows[0]);
});

app.get('/api/risk-actions',auth,requireRole('hr','manager'),async(req,res)=>{
  const ids=await visibleIds(req.user); if(!ids.length)return res.json([]);
  const r=await pool.query(`select ra.*,u.email,u.name,u.dept from risk_actions ra join app_users u on u.id=ra.user_id where ra.user_id=any($1::bigint[])`,[ids]);res.json(r.rows);
});
app.put('/api/risk-actions/:userId',auth,requireRole('hr','manager'),async(req,res)=>{
  const ids=await visibleIds(req.user),uid=Number(req.params.userId); if(!ids.includes(uid))return res.status(403).json({error:'권한이 없습니다.'});
  const b=req.body||{};
  const r=await pool.query(`insert into risk_actions(user_id,status,note,next_check,updated_by,updated_at) values($1,$2,$3,$4,$5,now())
  on conflict(user_id) do update set status=excluded.status,note=excluded.note,next_check=excluded.next_check,updated_by=excluded.updated_by,updated_at=now() returning *`,
  [uid,b.status||'open',b.note||'',b.next_check||null,req.user.email]);
  await audit(req.user.email,'UPDATE_RISK_ACTION',String(uid),b);res.json(r.rows[0]);
});
app.get('/api/audit',auth,requireRole('hr'),async(req,res)=>{
  const r=await pool.query('select * from audit_logs order by created_at desc limit 300');res.json(r.rows);
});

app.use(express.static(path.join(__dirname,'public')));
app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log('CROSSCERT WFH v11.1 listening',PORT))).catch(e=>{console.error('DB init failed',e);process.exit(1);});