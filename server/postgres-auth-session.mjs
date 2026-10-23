const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
// Only call after this exact access token has been verified by Auth. No token,
// refresh credential, or editable metadata is stored here or returned to clients.
export function createPostgresAuthSessionReader(client){
 if(typeof client?.query!=='function')throw Error('Private Auth session reader required');
 return async(subject,sessionId)=>{
  if(!uuid(subject)||!uuid(sessionId))return false;
  const result=await client.query('SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid AND (not_after IS NULL OR not_after>clock_timestamp())) AS active',[sessionId,subject]);
  return result.rows[0]?.active===true;
 };
}
