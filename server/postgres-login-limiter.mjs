// The database owns time and atomic global/account counters across server instances.
export function createPostgresLoginLimiter(client){
 if(typeof client?.query!=='function')throw Error('PostgreSQL client required');
 return async bucket=>{
  if(typeof bucket!=='string'||!/^[a-f0-9]{64}$/.test(bucket))throw Error('Hashed login bucket required');
  const {rows}=await client.query('SELECT mercury_guard.consume_login_attempt($1) AS allowed',[bucket]);
  return rows.length===1&&rows[0].allowed===true;
 };
}
