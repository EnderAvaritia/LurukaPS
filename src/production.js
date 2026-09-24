export function completed(job,now){return Math.min(job.count,Math.max(0,Math.floor((now-job.start)/job.seconds)));}
export function productionDue(state,now){return Object.values(state.home?.productionJobs||{}).some(jobs=>jobs.some(j=>completed(j,now)!==(j.reportedDone||0)));}
export function refreshProduction(state,now){if(!state.home)return false;let changed=false;
 for(const build of state.home.builds){const jobs=state.home.productionJobs?.[build.guid];if(!jobs)continue;const wire=jobs.map(j=>{const done=completed(j,now);j.reportedDone=done;return {product_id:j.productId,product_guid:j.guid,total_count:j.count-done,finish_count:done-j.claimed,start_time:j.start+done*j.seconds,finish_time:j.start+Math.min(j.count,done+1)*j.seconds,total_finish_time:j.start+j.count*j.seconds};});const status=jobs.some(j=>completed(j,now)<j.count)?4:1;if(JSON.stringify(build.product||[])!==JSON.stringify(wire)||build.status!==status){build.product=wire;build.status=status;changed=true;}}
 if(changed)state.homeRevision=(state.homeRevision||0)+1;return changed;
}
export function rescheduleJobs(jobs,now){let end=now;for(const job of jobs){if(job.start>now)job.start=Math.max(now,end);end=Math.max(end,job.start+job.count*job.seconds);}}
