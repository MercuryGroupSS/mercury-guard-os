import {randomUUID} from 'node:crypto';
// Synthetic dependency rows for disposable PostgreSQL verifiers only. This is
// not an Auth provider, credential generator or production session factory.
export async function fixtureAuthSession(owner,subject){
 const session={subject,sessionId:randomUUID(),active:true,expiresAt:Math.floor(Date.now()/1000)+7*86400};
 await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session.sessionId,subject]);
 return Object.freeze(session);
}
