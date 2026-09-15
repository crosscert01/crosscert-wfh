const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&process.env.DATABASE_URL.includes('railway')?{rejectUnauthorized:false}:undefined});
(async()=>{
  try{
    await pool.query(`
      alter table work_logs add column if not exists plan text default '';
      alter table work_logs add column if not exists completed text default '';
      alter table work_logs add column if not exists ongoing text default '';
      alter table work_logs add column if not exists next_plan text default '';
      alter table work_logs add column if not exists am_check text default '';
      alter table work_logs add column if not exists pm_check text default '';
      alter table work_logs add column if not exists mid_progress text default '';
      alter table work_logs add column if not exists completion_rate integer default 0;
      alter table work_logs add column if not exists availability text default '연락가능';
      alter table work_logs add column if not exists evidence text default '';
      alter table work_logs add column if not exists delay_reason text default '';
      alter table work_logs add column if not exists dept_profile text default '';
      alter table work_logs add column if not exists work_count integer default 0;
      alter table work_logs add column if not exists dept_evidence text default '';
      alter table work_logs add column if not exists remarks text default '';
      alter table work_logs add column if not exists approved boolean not null default false;
      alter table work_logs add column if not exists approved_by text default '';
      alter table work_logs add column if not exists approved_at timestamptz;
      alter table work_logs add column if not exists updated_at timestamptz not null default now();
    `);
    console.log('WFH schema migration OK');
  } catch(e){console.error('WFH schema migration FAILED',e);process.exitCode=1}
  finally{await pool.end()}
})();
