// v11.1 hotfix: PostgreSQL BIGINT values arrive as strings in node-postgres.
// Inline button arguments are numbers, so strict equality made detail/risk buttons appear unresponsive.
(function(){
  window.detailLog=function(id){
    const l=todayLogs.find(x=>String(x.id)===String(id));
    if(!l){ alert('해당 일지 상세정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.'); return; }
    alert(`[${l.name} / ${dateOnly(l.work_date)}]\n\n오늘 계획:\n${l.plan||'-'}\n\n완료:\n${l.completed||'-'}\n\n진행중:\n${l.ongoing||'-'}\n\n익일계획:\n${l.next_plan||'-'}\n\n업무충실도: ${fidelity(l)}점\n오전확인: ${l.am_check||'-'} / 오후확인: ${l.pm_check||'-'}\n계획대비 완료율: ${l.completion_rate||0}%\n연락·협업: ${l.availability||'-'}\n\n중간진척:\n${l.mid_progress||'-'}\n\n증빙:\n${l.evidence||'-'}\n\n부서별 기록:\n${l.dept_evidence||'-'}\n\n비고:\n${l.remarks||'-'}`);
  };
  window.openRisk=function(uid){
    const u=users.find(x=>String(x.id)===String(uid));
    if(!u){ alert('해당 직원 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.'); return; }
    const a=riskActions.find(x=>String(x.user_id)===String(uid))||{};
    document.getElementById('riskUid').value=String(uid);
    document.getElementById('riskTarget').innerText=`${u.name} / ${u.dept}`;
    document.getElementById('riskStatus').value=a.status||'open';
    document.getElementById('riskNote').value=a.note||'';
    document.getElementById('riskNext').value=dateOnly(a.next_check);
    document.getElementById('riskModal').classList.remove('hidden');
  };
  window.saveRiskAction=async function(){
    try{
      const uid=document.getElementById('riskUid').value;
      await api('/api/risk-actions/'+encodeURIComponent(uid),{method:'PUT',body:JSON.stringify({status:document.getElementById('riskStatus').value,note:document.getElementById('riskNote').value,next_check:document.getElementById('riskNext').value||null})});
      closeRisk(); await loadAll(); alert('조치내용이 저장되었습니다.');
    }catch(e){ alert('조치 저장 실패: '+e.message); }
  };
  window.approve=async function(id){
    try{ await api('/api/logs/'+encodeURIComponent(id)+'/approve',{method:'POST'}); await loadAll(); }
    catch(e){ alert('승인 처리 실패: '+e.message); }
  };
})();