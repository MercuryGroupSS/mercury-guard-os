const tables={events:'dashboard_bridge_state',shifts:'dashboard_shift_bridge_state',alerts:'dashboard_alert_bridge_state'};
export function dashboardBridgeState(outbox){
 if(outbox.bridgeState)return outbox.bridgeState;
 for(const table of Object.values(tables))outbox.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL)`);
 return {get:channel=>{const table=tables[channel];if(!table)throw Error('Unknown projection channel');return outbox.db.prepare(`SELECT cursor FROM ${table} WHERE id=1`).get()?.cursor??0;},
  save:(channel,cursor)=>{const table=tables[channel];if(!table||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid projection cursor');return outbox.db.prepare(`INSERT INTO ${table} VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor`).run(cursor);}};
}
