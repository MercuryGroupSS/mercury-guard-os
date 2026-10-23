import {administerVendor} from '../vendor-administration.mjs';
try{
 const args=process.argv.slice(2),options={};
 const names={'--database':'database','--vendor':'vendorId','--action':'action','--operator':'operator','--reason':'reason'};
 if(args.length%2)throw Error('Expected option/value pairs');
 for(let i=0;i<args.length;i+=2){const name=names[args[i]];if(!name||Object.hasOwn(options,name)||!args[i+1])throw Error('Invalid option');options[name]=args[i+1];}
 console.log(JSON.stringify(administerVendor(options)));
}catch{console.error('Vendor access operation failed. Supply --database existing-absolute-path --vendor vendor-id [--action inspect|suspend|activate]. Changes require --operator label --reason explanation. Check the database and inspect its current state before retrying.');process.exitCode=1;}
