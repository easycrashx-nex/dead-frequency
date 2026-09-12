import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../src/online-client.js';

const identity={id:'alice',username:'Alice'};
const profile={credits:750,stash:[],intake:[]};
const people={friends:[{id:'bob',username:'Bob',status:'online',room:null}],incoming:[],outgoing:[],invitations:[]};
const lobbies={rooms:[{roomId:'room-1',visibility:'public',playerCount:1}],room:null,capacity:{rooms:1,maxRooms:2}};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
async function setup(request){
  const client=createOnlineClient({request:(route,options)=>route==='/api/auth/login'?{user:identity,profile}:request(route,options)});
  await client.authenticate('login','Alice','test-password');return client;
}

test('authenticated social polling combines safe lobby and friendship state without mutating profile',async()=>{
  const calls=[];
  const client=await setup((route,options)=>{calls.push([route,options]);return route==='/api/social'?people:lobbies;});
  assert.equal(await client.refreshSocial(),true);
  assert.deepEqual(client.social.friends,people.friends);assert.deepEqual(client.social.rooms,lobbies.rooms);
  assert.deepEqual(client.profile,profile);assert.equal(client.social.loading,false);assert.ok(client.social.updatedAt>0);
  assert.deepEqual(calls.map(([route,options])=>[route,options.method]),[['/api/social','GET'],['/api/rooms','GET']]);
});

test('overlapping refresh calls make only one pair of requests',async()=>{
  const response=deferred();let calls=0;
  const client=await setup(async route=>{calls++;await response.promise;return route==='/api/social'?people:lobbies;});
  const first=client.refreshSocial(),second=client.refreshSocial();assert.equal(calls,2);
  response.resolve();await Promise.all([first,second]);assert.equal(client.social.loading,false);
});

test('a delayed social read cannot restore account data after logout',async()=>{
  const response=deferred();
  const client=await setup(async route=>{if(route==='/api/auth/logout')return{ok:true};await response.promise;return route==='/api/social'?people:lobbies;});
  const reading=client.refreshSocial();await client.logout();response.resolve();await reading;
  assert.equal(client.info.authenticated,false);assert.deepEqual(client.social.friends,[]);assert.deepEqual(client.social.rooms,[]);assert.equal(client.social.loading,false);
});

test('social mutations invalidate older polling and block duplicate submissions',async()=>{
  const old=deferred(),mutation=deferred();let writes=0;
  const client=await setup(async route=>{
    if(route==='/api/friends/request'){writes++;return mutation.promise;}
    await old.promise;return route==='/api/social'?people:lobbies;
  });
  const reading=client.refreshSocial(),writing=client.socialAction('request',{username:'Bob'});
  assert.equal(await client.socialAction('request',{username:'Bob'}),false);assert.equal(writes,1);
  mutation.resolve({ok:true});await writing;old.resolve();await reading;assert.deepEqual(client.social.friends,[]);
});

test('room browser and friend invitation join send only admission fields',async()=>{
  const calls=[];
  const client=await setup((route,options)=>{calls.push([route,options.body]);return{roomId:'room-1',mode:'coop',visibility:'friends',ticket:'once'};});
  const loadout={mode:'preset',presetId:'scout'};
  await client.room('join',{roomId:'room-1',invite:'ignored',loadout,profile:{credits:999999}});
  await client.room('invitation',{invitationId:'invitation-1',loadout,profile:{credits:999999}});
  await client.room('coop',{loadout,difficulty:'hard',visibility:'friends'});
  assert.deepEqual(calls,[
    ['/api/rooms/join',{roomId:'room-1',loadout}],
    ['/api/rooms/invitation',{invitationId:'invitation-1',accept:true,loadout}],
    ['/api/rooms/create',{mode:'coop',loadout,difficulty:'hard',visibility:'friends'}],
  ]);
  assert.equal(client.info.room.visibility,'friends');assert.equal(JSON.stringify(client.info).includes('once'),false);
});

test('expired authentication clears social data and stops subsequent polling',async()=>{
  let expired=false,calls=0;
  const client=await setup(route=>{calls++;if(expired)return{error:'Bitte anmelden.',status:401};return route==='/api/social'?people:lobbies;});
  await client.refreshSocial();expired=true;assert.equal(await client.refreshSocial(),false);
  assert.equal(client.info.sessionExpired,true);assert.deepEqual(client.social.friends,[]);
  const before=calls;assert.equal(await client.refreshSocial(),false);assert.equal(calls,before);
});

test('failed invitation acceptance creates no optimistic room and arbitrary social routes are refused',async()=>{
  let calls=0;
  const client=await setup(()=>{calls++;return{error:'Die Sitzung ist voll.',status:409};});
  await assert.rejects(client.room('invitation',{invitationId:'expired'}),/voll/);
  assert.equal(client.info.room,null);assert.equal(client.info.busy,false);
  await assert.rejects(client.socialAction('https://elsewhere.invalid',{}),/Unbekannte/);assert.equal(calls,1);
});

test('a delayed unauthorized response from an old login cannot expire the newly authenticated account',async()=>{
  const response=deferred();let logins=0;
  const client=createOnlineClient({request:route=>{
    if(route==='/api/auth/login')return{user:++logins===1?identity:{id:'bravo',username:'Bravo'},profile};
    if(route==='/api/auth/logout')return{ok:true};
    return response.promise;
  }});
  await client.authenticate('login','Alice','test-password');const old=client.refreshSocial();
  await client.logout();await client.authenticate('login','Bravo','test-password');
  response.resolve({error:'Bitte anmelden.',status:401});await old;
  assert.equal(client.info.user.id,'bravo');assert.equal(client.info.sessionExpired,false);assert.equal(client.info.authenticated,true);
});
