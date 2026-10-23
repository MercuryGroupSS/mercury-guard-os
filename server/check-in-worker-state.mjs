export function checkInWorkerState(store){
 if(store.workerState)return store.workerState;
 store.db.exec(`CREATE TABLE IF NOT EXISTS check_in_worker_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS check_in_worker_runs(assignment TEXT,revision INTEGER,finalized INTEGER NOT NULL,last_success INTEGER NOT NULL,PRIMARY KEY(assignment,revision));`);
 return {cursor:()=>store.db.prepare('SELECT cursor FROM check_in_worker_state WHERE id=1').get()?.cursor??'',
  finalized:(id,revision)=>!!store.db.prepare('SELECT finalized FROM check_in_worker_runs WHERE assignment=? AND revision=?').get(id,revision)?.finalized,
  mark:(id,revision,finalized,at)=>store.db.prepare('INSERT INTO check_in_worker_runs VALUES(?,?,?,?) ON CONFLICT(assignment,revision) DO UPDATE SET finalized=excluded.finalized,last_success=excluded.last_success').run(id,revision,Number(finalized),at),
  saveCursor:cursor=>store.db.prepare('INSERT INTO check_in_worker_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(cursor)};
}
export function postgresCheckInWorkerState(pool){
 return {cursor:async()=>(await pool.query('SELECT cursor FROM mercury_guard.check_in_worker_state WHERE id=1')).rows[0]?.cursor??'',
  finalized:async(id,revision)=>(await pool.query('SELECT finalized FROM mercury_guard.check_in_worker_runs WHERE assignment_id=$1 AND revision=$2',[id,revision])).rows[0]?.finalized===true,
  mark:(id,revision,finalized,at)=>pool.query('INSERT INTO mercury_guard.check_in_worker_runs VALUES($1,$2,$3,$4) ON CONFLICT(assignment_id,revision) DO UPDATE SET finalized=excluded.finalized,last_success=excluded.last_success',[id,revision,finalized,at]),
  saveCursor:cursor=>pool.query('INSERT INTO mercury_guard.check_in_worker_state VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor',[cursor])};
}
