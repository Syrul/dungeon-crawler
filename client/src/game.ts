// game.ts — Dungeon Crawler game logic
// Server-authoritative multiplayer with client interpolation

import type { GameMode, GameCallbacks, PlayerClass } from './types';
import { CLASS_STATS } from './types';

let gameMode: GameMode = 'online'; // Always online - server-authoritative
let callbacks: GameCallbacks = {};

// Player class selection state
let playerClass: PlayerClass = 'healer'; // Default class
let classSelected: boolean = false; // Whether class has been selected this session

export function setGameMode(mode: GameMode) {
  gameMode = mode;
}

export function setCallbacks(cb: GameCallbacks) {
  callbacks = cb;
}

// Discard functions for inventory management
function discardFromBackpack(idx: number) {
  backpack.splice(idx, 1);
}

function discardCard(idx: number) {
  cardInventory.splice(idx, 1);
}

// Make functions available globally for inline onclick handlers in tooltips
function exposeGlobals() {
  (window as any).equipFromBackpack = equipFromBackpack;
  (window as any).closeTooltip = closeTooltip;
  (window as any).renderInventory = renderInventory;
  (window as any).unequipItem = unequipItem;
  (window as any).openCardSlotModal = openCardSlotModal;
  (window as any).discardFromBackpack = discardFromBackpack;
  (window as any).discardCard = discardCard;
  (window as any).backpack = backpack;
  (window as any).cardInventory = cardInventory;
}

// ─── CONFIG ───
const TILE = 36; // Fixed to match server - no dynamic scaling
const PLAYER_R = 14;
const CAM_SMOOTH = 0.08;

// ─── HAPTICS ───
function haptic(type){
  try{
    if(navigator.vibrate){
      switch(type){
        case'light':navigator.vibrate(10);break;
        case'medium':navigator.vibrate(25);break;
        case'heavy':navigator.vibrate(50);break;
        case'kill':navigator.vibrate([20,30,40]);break;
        case'die':navigator.vibrate([50,30,50,30,100]);break;
        case'win':navigator.vibrate([30,50,30,50,30,50,100]);break;
      }
    }
  }catch(e){}
}

// ─── SFX (Web Audio API) ───
let audioCtx;
function initAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||(window as any).webkitAudioContext)();}
function sfx(type){
  initAudio();if(!audioCtx)return;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.connect(g);g.connect(audioCtx.destination);
  const t=audioCtx.currentTime;
  switch(type){
    case'hit':
      o.type='square';o.frequency.setValueAtTime(200,t);o.frequency.exponentialRampToValueAtTime(80,t+0.1);
      g.gain.setValueAtTime(0.3,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.1);
      o.start(t);o.stop(t+0.1);break;
    case'kill':
      o.type='square';o.frequency.setValueAtTime(400,t);o.frequency.exponentialRampToValueAtTime(800,t+0.1);
      g.gain.setValueAtTime(0.25,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.15);
      o.start(t);o.stop(t+0.15);break;
    case'attack':
      o.type='sawtooth';o.frequency.setValueAtTime(300,t);o.frequency.exponentialRampToValueAtTime(100,t+0.08);
      g.gain.setValueAtTime(0.2,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.08);
      o.start(t);o.stop(t+0.08);break;
    case'dash':
      o.type='sine';o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(600,t+0.15);
      g.gain.setValueAtTime(0.2,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.15);
      o.start(t);o.stop(t+0.15);break;
    case'hurt':
      o.type='sawtooth';o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(50,t+0.2);
      g.gain.setValueAtTime(0.3,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.2);
      o.start(t);o.stop(t+0.2);break;
    case'door':
      o.type='sine';o.frequency.setValueAtTime(400,t);o.frequency.exponentialRampToValueAtTime(600,t+0.1);
      g.gain.setValueAtTime(0.2,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.3);
      o.start(t);o.stop(t+0.3);
      const o2=audioCtx.createOscillator(),g2=audioCtx.createGain();
      o2.connect(g2);g2.connect(audioCtx.destination);
      o2.type='sine';o2.frequency.setValueAtTime(600,t+0.1);o2.frequency.exponentialRampToValueAtTime(800,t+0.2);
      g2.gain.setValueAtTime(0.2,t+0.1);g2.gain.exponentialRampToValueAtTime(0.01,t+0.3);
      o2.start(t+0.1);o2.stop(t+0.3);break;
    case'win':
      [400,500,600,800].forEach((f,i)=>{
        const ow=audioCtx.createOscillator(),gw=audioCtx.createGain();
        ow.connect(gw);gw.connect(audioCtx.destination);
        ow.type='sine';ow.frequency.setValueAtTime(f,t+i*0.15);
        gw.gain.setValueAtTime(0.2,t+i*0.15);gw.gain.exponentialRampToValueAtTime(0.01,t+i*0.15+0.3);
        ow.start(t+i*0.15);ow.stop(t+i*0.15+0.3);
      });break;
    case'die':
      o.type='sawtooth';o.frequency.setValueAtTime(300,t);o.frequency.exponentialRampToValueAtTime(30,t+0.5);
      g.gain.setValueAtTime(0.3,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.5);
      o.start(t);o.stop(t+0.5);break;
    case'pickup':
      o.type='sine';o.frequency.setValueAtTime(600,t);o.frequency.exponentialRampToValueAtTime(900,t+0.1);
      g.gain.setValueAtTime(0.15,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.15);
      o.start(t);o.stop(t+0.15);break;
    case'levelup':
      [500,600,700,800,1000].forEach((f,i)=>{
        const ol=audioCtx.createOscillator(),gl=audioCtx.createGain();
        ol.connect(gl);gl.connect(audioCtx.destination);
        ol.type='sine';ol.frequency.setValueAtTime(f,t+i*0.1);
        gl.gain.setValueAtTime(0.2,t+i*0.1);gl.gain.exponentialRampToValueAtTime(0.01,t+i*0.1+0.2);
        ol.start(t+i*0.1);ol.stop(t+i*0.1+0.2);
      });break;
    case'charge_impact':
      o.type='sawtooth';o.frequency.setValueAtTime(80,t);o.frequency.exponentialRampToValueAtTime(30,t+0.2);
      g.gain.setValueAtTime(0.4,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.25);
      o.start(t);o.stop(t+0.25);break;
    case'explosion':
      o.type='sawtooth';o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(20,t+0.4);
      g.gain.setValueAtTime(0.5,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.4);
      o.start(t);o.stop(t+0.4);
      {const o3=audioCtx.createOscillator(),g3=audioCtx.createGain();
      o3.connect(g3);g3.connect(audioCtx.destination);
      o3.type='square';o3.frequency.setValueAtTime(60,t);o3.frequency.exponentialRampToValueAtTime(15,t+0.3);
      g3.gain.setValueAtTime(0.3,t);g3.gain.exponentialRampToValueAtTime(0.01,t+0.35);
      o3.start(t);o3.stop(t+0.35);}break;
    case'summon':
      o.type='sine';o.frequency.setValueAtTime(200,t);o.frequency.exponentialRampToValueAtTime(500,t+0.3);
      g.gain.setValueAtTime(0.15,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.4);
      o.start(t);o.stop(t+0.4);
      {const o4=audioCtx.createOscillator(),g4=audioCtx.createGain();
      o4.connect(g4);g4.connect(audioCtx.destination);
      o4.type='sine';o4.frequency.setValueAtTime(350,t+0.1);o4.frequency.exponentialRampToValueAtTime(700,t+0.35);
      g4.gain.setValueAtTime(0.12,t+0.1);g4.gain.exponentialRampToValueAtTime(0.01,t+0.4);
      o4.start(t+0.1);o4.stop(t+0.4);}break;
    case'shield_block':
      o.type='square';o.frequency.setValueAtTime(300,t);o.frequency.exponentialRampToValueAtTime(150,t+0.08);
      g.gain.setValueAtTime(0.25,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.1);
      o.start(t);o.stop(t+0.1);break;
    case'taunt':
      o.type='square';o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(300,t+0.15);
      g.gain.setValueAtTime(0.3,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.2);
      o.start(t);o.stop(t+0.2);break;
    case'knockback':
      o.type='sawtooth';o.frequency.setValueAtTime(100,t);o.frequency.exponentialRampToValueAtTime(40,t+0.25);
      g.gain.setValueAtTime(0.35,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.3);
      o.start(t);o.stop(t+0.3);break;
    case'heal':
      o.type='sine';o.frequency.setValueAtTime(400,t);o.frequency.exponentialRampToValueAtTime(800,t+0.2);
      g.gain.setValueAtTime(0.2,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.3);
      o.start(t);o.stop(t+0.3);
      {const oh=audioCtx.createOscillator(),gh=audioCtx.createGain();
      oh.connect(gh);gh.connect(audioCtx.destination);
      oh.type='sine';oh.frequency.setValueAtTime(600,t+0.1);oh.frequency.exponentialRampToValueAtTime(1000,t+0.25);
      gh.gain.setValueAtTime(0.15,t+0.1);gh.gain.exponentialRampToValueAtTime(0.01,t+0.35);
      oh.start(t+0.1);oh.stop(t+0.35);}break;
  }
}
const ATTACK_RANGE = 50;
const BASE_ATTACK_DMG = 25;
const ATTACK_CD = 0.6;
const DASH_DIST = 120;
const DASH_CD = 3;
const DASH_DUR = 0.15;

// ─── GEAR SYSTEM (Diablo/RO Overhaul) ───
const RARITIES = [
  {name:'common',color:'#ffffff',idx:0},
  {name:'uncommon',color:'#22c55e',idx:1},
  {name:'rare',color:'#3b82f6',idx:2},
  {name:'epic',color:'#a855f7',idx:3},
  {name:'legendary',color:'#f97316',idx:4}
];
const RARITY_MAP={common:RARITIES[0],uncommon:RARITIES[1],rare:RARITIES[2],epic:RARITIES[3],legendary:RARITIES[4]};

// Rarity weights by depth bracket
const RARITY_WEIGHTS_BY_DEPTH=[
  {common:60,uncommon:30,rare:8,epic:1.5,legendary:0.5},   // depth 1-2
  {common:40,uncommon:35,rare:18,epic:5,legendary:2},       // depth 3-5
  {common:25,uncommon:30,rare:28,epic:12,legendary:5}        // depth 6+
];
function getRarityWeights(depth,isBoss){
  const bracket=depth<=2?0:depth<=5?1:2;
  const w={...RARITY_WEIGHTS_BY_DEPTH[bracket]};
  if(isBoss){
    // Shift up: reduce common/uncommon, boost rare+
    w.common*=0.3;w.uncommon*=0.5;w.rare*=1.5;w.epic*=2;w.legendary*=2.5;
  }
  return w;
}
function pickRarity(depth,isBoss){
  const w=getRarityWeights(depth,isBoss);
  const entries=Object.entries(w);
  const total=entries.reduce((a,[,v])=>a+v,0);
  let roll=Math.random()*total;
  for(const[name,weight]of entries){roll-=weight;if(roll<=0)return RARITY_MAP[name];}
  return RARITIES[0];
}

const GEAR_TYPES={
  weapon:[{name:'Sword',icon:'⚔️',base:{ATK:8}},{name:'Axe',icon:'🪓',base:{ATK:10}},{name:'Dagger',icon:'🗡️',base:{ATK:6,Speed:5}},{name:'Staff',icon:'🪄',base:{ATK:5,HP:10}},{name:'Hammer',icon:'🔨',base:{ATK:12}}],
  armor:[{name:'Shield',icon:'🛡️',base:{DEF:6}},{name:'Chestplate',icon:'🦺',base:{DEF:8,HP:5}},{name:'Helm',icon:'⛑️',base:{DEF:4,HP:8}},{name:'Robe',icon:'👘',base:{DEF:3,HP:12}}],
  accessory:[{name:'Ring',icon:'💍',base:{ATK:3}},{name:'Amulet',icon:'📿',base:{HP:15}},{name:'Charm',icon:'🔮',base:{DEF:2,ATK:2}},{name:'Cape',icon:'🧣',base:{Speed:8,DEF:2}}]
};
const STAT_TYPES=['ATK','DEF','HP','Speed'];

// ─── AFFIX SYSTEM ───
const PREFIXES=[
  {name:'Mighty',stat:'ATK',flat:true,base:3,scale:1.5},
  {name:'Sturdy',stat:'DEF',flat:true,base:2,scale:1},
  {name:'Vital',stat:'HP',flat:true,base:8,scale:4},
  {name:'Swift',stat:'Speed',flat:true,base:3,scale:1.5},
  {name:'Vampiric',stat:'lifesteal',pct:true,base:2,scale:0.5},
  {name:'Thorny',stat:'reflect',flat:true,base:2,scale:1},
  {name:'Lucky',stat:'dropRate',pct:true,base:3,scale:1}
];
const SUFFIXES=[
  {name:'of Power',stat:'ATK',pct:true,base:5,scale:2},
  {name:'of the Bear',stat:'HP',flat:true,base:10,scale:5},
  {name:'of Haste',stat:'Speed',pct:true,base:5,scale:2},
  {name:'of the Leech',stat:'lifesteal',flat:true,base:1,scale:0.5},
  {name:'of Fortune',stat:'goldBonus',pct:true,base:5,scale:2},
  {name:'of Destruction',stat:'crit',pct:true,base:3,scale:1.5},
  {name:'of Protection',stat:'DEF',pct:true,base:5,scale:2}
];

function rollAffixValue(affix,ilvl){
  const val=affix.base+Math.floor(Math.random()*affix.scale*ilvl);
  return Math.max(1,val);
}

function rollAffixes(rarity,ilvl){
  const affixes=[];
  let numAffixes=0;
  if(rarity.name==='common')numAffixes=0;
  else if(rarity.name==='uncommon')numAffixes=1;
  else if(rarity.name==='rare')numAffixes=2;
  else if(rarity.name==='epic')numAffixes=2+Math.floor(Math.random()*2); // 2-3
  else if(rarity.name==='legendary')numAffixes=3;

  const usedPrefixes=[], usedSuffixes=[];
  let hasPrefix=false, hasSuffix=false;
  for(let i=0;i<numAffixes;i++){
    // Alternate prefix/suffix, but allow doubles if needed
    const pool=(!hasPrefix||Math.random()<0.5)&&usedPrefixes.length<PREFIXES.length?'prefix':'suffix';
    if(pool==='prefix'){
      let p;do{p=PREFIXES[Math.floor(Math.random()*PREFIXES.length)];}while(usedPrefixes.includes(p.name)&&usedPrefixes.length<PREFIXES.length);
      if(!usedPrefixes.includes(p.name)){
        usedPrefixes.push(p.name);
        affixes.push({...p,value:rollAffixValue(p,ilvl),type:'prefix'});
        hasPrefix=true;
      }
    }else{
      let s;do{s=SUFFIXES[Math.floor(Math.random()*SUFFIXES.length)];}while(usedSuffixes.includes(s.name)&&usedSuffixes.length<SUFFIXES.length);
      if(!usedSuffixes.includes(s.name)){
        usedSuffixes.push(s.name);
        affixes.push({...s,value:rollAffixValue(s,ilvl),type:'suffix'});
        hasSuffix=true;
      }
    }
  }
  return affixes;
}

// ─── LEGENDARY ITEMS ───
const LEGENDARY_ITEMS=[
  {name:'Ragnarok Blade',icon:'⚔️',slot:'weapon',base:{ATK:30},passive:'10% chance to deal 3x damage',passiveId:'ragnarokBlade'},
  {name:'Yggdrasil Leaf',icon:'🍃',slot:'accessory',base:{HP:40},passive:'Auto-revive once per dungeon (full HP)',passiveId:'yggdrasilLeaf'},
  {name:"Slime King's Crown",icon:'👑',slot:'armor',base:{DEF:12,HP:20},passive:'Slimes deal 50% less damage to you',passiveId:'slimeKingCrown'},
  {name:"Bomber's Last Gift",icon:'💣',slot:'accessory',base:{ATK:10},passive:'Kills have 15% chance to explode nearby enemies',passiveId:'bombersGift'},
  {name:'Necro Lord Staff',icon:'🪄',slot:'weapon',base:{ATK:18,HP:15},passive:'10% chance killed enemies fight for you briefly',passiveId:'necroStaff'},
  {name:"Fenrir's Fang",icon:'🐺',slot:'weapon',base:{ATK:20,Speed:10},passive:'+20% speed, attacks apply slow',passiveId:'fenrirFang'},
  {name:"Odin's Eye",icon:'👁️',slot:'accessory',base:{ATK:8},passive:'Always see enemy HP, +15% crit chance',passiveId:'odinsEye'},
  {name:'Mjolnir Shard',icon:'🔨',slot:'weapon',base:{ATK:25},passive:'Attacks chain lightning to 2 nearby enemies for 30% dmg',passiveId:'mjolnirShard'},
  {name:'Valkyrie Aegis',icon:'🛡️',slot:'armor',base:{DEF:18,HP:15},passive:'20% chance to negate damage completely',passiveId:'valkyrieAegis'},
  {name:'Loki\'s Trinket',icon:'🔮',slot:'accessory',base:{Speed:12},passive:'Dash cooldown reduced 50%, leave damaging trail',passiveId:'lokiTrinket'},
  {name:'Hel\'s Embrace',icon:'👘',slot:'armor',base:{HP:50},passive:'Gain 3% max HP on kill',passiveId:'helsEmbrace'},
  {name:'Gungnir Tip',icon:'🗡️',slot:'weapon',base:{ATK:22},passive:'First hit on each enemy deals 2x damage',passiveId:'gungnirTip'},
  {name:'Bifrost Ring',icon:'💍',slot:'accessory',base:{Speed:8,DEF:5},passive:'Teleport short distance on dash instead of slide',passiveId:'bifrostRing'},
  {name:'Surtr\'s Ember',icon:'🔥',slot:'accessory',base:{ATK:15},passive:'Attacks burn enemies for 5 dmg/sec for 3s',passiveId:'surtrEmber'},
  {name:'Freya\'s Blessing',icon:'📿',slot:'accessory',base:{HP:25,DEF:8},passive:'Regenerate 1% max HP per second',passiveId:'freyaBlessing'},
  // Class-specific legendaries
  // Tank legendaries
  {name:'Taunt Gauntlets',icon:'🧤',slot:'armor',base:{DEF:20,HP:30},passive:'Taunt also applies 30% slow to target',passiveId:'tauntGauntlets',classReq:'tank'},
  {name:'Aegis of Defiance',icon:'🔰',slot:'accessory',base:{DEF:15,HP:25},passive:'Slow aura radius increased to 80px',passiveId:'aegisDefiance',classReq:'tank'},
  // Healer legendaries
  {name:'Healing Vestments',icon:'🥋',slot:'armor',base:{HP:40,DEF:10},passive:'Passive heal aura range +50%, heal +50%',passiveId:'healingVestments',classReq:'healer'},
  {name:'Staff of Renewal',icon:'✨',slot:'weapon',base:{ATK:12,HP:20},passive:'Healing zone duration +4s, radius +20px',passiveId:'staffRenewal',classReq:'healer'},
  // DPS legendaries
  {name:"Assassin's Cloak",icon:'🦇',slot:'armor',base:{ATK:15,Speed:10},passive:'Backstab damage +75% (total +125%)',passiveId:'assassinCloak',classReq:'dps'},
  {name:'Shadowstep Boots',icon:'👢',slot:'accessory',base:{Speed:15,ATK:8},passive:'Dash CD -0.5s, post-dash bonus +1s',passiveId:'shadowstepBoots',classReq:'dps'}
];

function generateLegendary(slot,ilvl,classReq?:string){
  // Filter by slot, and optionally by class requirement
  let candidates=LEGENDARY_ITEMS.filter(l=>l.slot===slot);

  // If classReq is specified, prefer class-specific items (50% chance) or any item
  if(classReq && Math.random()<0.5){
    const classItems=candidates.filter(l=>l.classReq===classReq);
    if(classItems.length>0) candidates=classItems;
  }

  // Filter out class-specific items that don't match player's class
  if(!classReq){
    candidates=candidates.filter(l=>!l.classReq || l.classReq===playerClass);
  }

  if(candidates.length===0)return generateGear(slot,ilvl,false); // fallback
  const leg=candidates[Math.floor(Math.random()*candidates.length)];
  const stats={};
  for(const[k,v]of Object.entries(leg.base)){
    stats[k]=Math.ceil(v*(1+ilvl*0.1)*(0.85+Math.random()*0.3)); // partially random
  }
  const affixes=rollAffixes(RARITIES[4],ilvl);
  return{slot,name:leg.name,icon:leg.icon,rarity:'legendary',rarityColor:'#f97316',stats,affixes,
    passive:leg.passive,passiveId:leg.passiveId,classReq:leg.classReq,ilvl,cardSlot:null,isNew:true,
    id:Math.random().toString(36).substr(2,9)};
}

function generateGear(slot,depth,isBoss){
  const ilvl=depth||1;
  const rarity=pickRarity(ilvl,isBoss);
  if(rarity.name==='legendary')return generateLegendary(slot,ilvl);
  const types=GEAR_TYPES[slot];
  const type=types[Math.floor(Math.random()*types.length)];
  const stats:Record<string,number>={};
  for(const[k,v]of Object.entries(type.base)){
    stats[k]=Math.ceil((v as number)*(1+ilvl*0.15)*(0.8+Math.random()*0.4));
  }
  const affixes=rollAffixes(rarity,ilvl);
  // Apply affix flat stats to stats
  // (percentage affixes are computed at equip time via getGearStats)
  
  // Build name from affixes
  let prefix='',suffix='';
  const prefixAffix=affixes.find(a=>a.type==='prefix');
  const suffixAffix=affixes.find(a=>a.type==='suffix');
  if(prefixAffix)prefix=prefixAffix.name+' ';
  if(suffixAffix)suffix=' '+suffixAffix.name;
  const finalName=prefix+type.name+suffix;
  
  return{slot,name:finalName,icon:type.icon,rarity:rarity.name,rarityColor:rarity.color,stats,affixes,
    passive:null,passiveId:null,ilvl,cardSlot:null,isNew:true,
    id:Math.random().toString(36).substr(2,9)};
}

// ─── CARD SYSTEM (Ragnarok-style) ───
const CARD_DEFS={
  slime:{name:'Slime Card',icon:'🟢',bonus:{HP:5},bonusType:'pct',desc:'+5% HP'},
  skeleton:{name:'Skeleton Card',icon:'🦴',bonus:{ATK:10},bonusType:'pct',desc:'+10% ATK'},
  wolf:{name:'Wolf Card',icon:'🐺',bonus:{Speed:10},bonusType:'pct',desc:'+10% Speed'},
  archer:{name:'Archer Card',icon:'🏹',bonus:{crit:5},bonusType:'flat',desc:'+5% Crit'},
  charger:{name:'Charger Card',icon:'🐂',bonus:{DEF:8},bonusType:'pct',desc:'+8% DEF'},
  bomber:{name:'Bomber Card',icon:'💣',bonus:{ATK:5},bonusType:'pct',desc:'+5% ATK, explosions'},
  necromancer:{name:'Necromancer Card',icon:'💀',bonus:{HP:8,ATK:3},bonusType:'pct',desc:'+8% HP, +3% ATK'},
  shield_knight:{name:'Shield Knight Card',icon:'🛡️',bonus:{DEF:12},bonusType:'pct',desc:'+12% DEF'},
  boss:{name:'MVP Card',icon:'👹',bonus:{ATK:8,HP:5,DEF:5},bonusType:'pct',desc:'+8% ATK, +5% HP, +5% DEF'}
};
let cardInventory=[]; // collected cards not yet slotted

// ─── DROP TABLE SYSTEM ───
const DROP_TABLES={
  slime:{
    goldRange:[3,10],gearChance:0.2,
    slotWeights:{weapon:20,armor:50,accessory:30},
    preferredTypes:{armor:['Robe']},
    cardChance:0.02
  },
  skeleton:{
    goldRange:[5,15],gearChance:0.3,
    slotWeights:{weapon:50,armor:40,accessory:10},
    preferredTypes:{weapon:['Sword','Axe'],armor:['Chestplate','Helm']},
    cardChance:0.02
  },
  wolf:{
    goldRange:[3,12],gearChance:0.25,
    slotWeights:{weapon:20,armor:40,accessory:40},
    preferredTypes:{armor:['Robe'],accessory:['Cape','Ring']},
    cardChance:0.02
  },
  archer:{
    goldRange:[5,15],gearChance:0.25,
    slotWeights:{weapon:40,armor:20,accessory:40},
    preferredTypes:{weapon:['Dagger'],accessory:['Ring','Charm']},
    cardChance:0.015
  },
  charger:{
    goldRange:[8,20],gearChance:0.35,
    slotWeights:{weapon:50,armor:30,accessory:20},
    preferredTypes:{weapon:['Hammer','Axe'],armor:['Helm']},
    cardChance:0.02
  },
  bomber:{
    goldRange:[6,18],gearChance:0.3,
    slotWeights:{weapon:20,armor:20,accessory:60},
    preferredTypes:{accessory:['Charm','Ring']},
    cardChance:0.015
  },
  necromancer:{
    goldRange:[15,30],gearChance:0.45,
    slotWeights:{weapon:50,armor:30,accessory:20},
    preferredTypes:{weapon:['Staff'],armor:['Robe']},
    cardChance:0.03
  },
  shield_knight:{
    goldRange:[10,25],gearChance:0.4,
    slotWeights:{weapon:20,armor:60,accessory:20},
    preferredTypes:{armor:['Shield','Chestplate']},
    cardChance:0.02
  },
  boss:{
    goldRange:[50,100],gearChance:1.0,numDrops:[2,4],
    slotWeights:{weapon:35,armor:35,accessory:30},
    preferredTypes:{},
    cardChance:0.05
  }
};

function pickSlotFromTable(table){
  const w=table.slotWeights;
  const total=w.weapon+w.armor+w.accessory;
  const roll=Math.random()*total;
  if(roll<w.weapon)return'weapon';
  if(roll<w.weapon+w.armor)return'armor';
  return'accessory';
}

function getComputedStats(item){
  // Compute total stats including affix flat bonuses
  const s={ATK:0,DEF:0,HP:0,Speed:0,crit:0,lifesteal:0,reflect:0,dropRate:0,goldBonus:0};
  // Base stats
  if(item.stats){for(const[k,v]of Object.entries(item.stats)){if(k in s)s[k]+=v;}}
  // Affix flat bonuses
  if(item.affixes){
    item.affixes.forEach(a=>{
      if(a.flat&&a.stat in s)s[a.stat]+=a.value;
    });
  }
  // Affix percentage bonuses (applied to base)
  if(item.affixes){
    item.affixes.forEach(a=>{
      if(a.pct&&a.stat in s){
        // Percentage of the base stat value for this item
        const base=item.stats[a.stat]||0;
        s[a.stat]+=Math.ceil(base*a.value/100);
      }
    });
  }
  // Card bonuses (percentage of item base stats)
  if(item.cardSlot){
    const card=CARD_DEFS[item.cardSlot];
    if(card){
      for(const[k,v]of Object.entries(card.bonus)){
        if(card.bonusType==='pct'){
          const base=item.stats[k]||10; // minimum base of 10 for pct
          s[k]+=Math.ceil(base*(v as number)/100);
        }else{
          if(k in s)s[k]+=(v as number);
        }
      }
    }
  }
  return s;
}

// ─── PERSISTENT STATE ───
let gold=0,dungeonDepth=1;
let playerLevel=1,playerXP=0;
let baseMaxHp=100,baseAtk=0,baseDef=0,baseSpeed=0;
let equipped={weapon:null,armor:null,accessory:null};
let backpack=[]; // max 16

// ─── LIFETIME STATS ───
let lifetimeKills=0, lifetimeDungeons=0, lifetimeGold=0;

// ─── SLOW-MO FOR LEVEL UP ───
let slowMoTimer=0;
let levelUpAnimTimer=0;
let lastPositionSendTime=0;

function xpToLevel(lv){return lv*50;}

function getGearStats(){
  let s={ATK:0,DEF:0,HP:0,Speed:0,crit:0,lifesteal:0,reflect:0,dropRate:0,goldBonus:0};
  for(let sl in equipped){
    if(equipped[sl]){
      const cs=getComputedStats(equipped[sl]);
      for(let k in cs)s[k]=(s[k]||0)+cs[k];
    }
  }
  return s;
}
function hasPassive(id){
  for(let sl in equipped){if(equipped[sl]&&equipped[sl].passiveId===id)return true;}
  return false;
}
function getEquippedPassives(){
  const p=[];
  for(let sl in equipped){if(equipped[sl]&&equipped[sl].passiveId)p.push(equipped[sl].passiveId);}
  return p;
}

function totalAtk(){return BASE_ATTACK_DMG+baseAtk+getGearStats().ATK;}
function totalDef(){return baseDef+getGearStats().DEF;}
function totalMaxHp(){return baseMaxHp+getGearStats().HP;}
function totalSpeed(){
  let spd=160+baseSpeed+getGearStats().Speed*10;
  if(hasPassive('fenrirFang'))spd*=1.2;
  return Math.round(spd);
}

// ─── PLAYER VISUAL PROGRESSION ───
// Now uses class-based colors with level-based intensity/effects
function getPlayerColor(){
  // Base color from class
  const baseColors = getClassColorInternal(playerClass);
  // High level players get a golden glow effect (handled separately in rendering)
  return baseColors;
}

function getClassColorInternal(pClass: PlayerClass): { main: string; mid: string; light: string } {
  switch (pClass) {
    case 'tank':
      return { main: '#3b82f6', mid: '#2563eb', light: '#93c5fd' }; // blue
    case 'healer':
      return { main: '#22c55e', mid: '#16a34a', light: '#86efac' }; // green
    case 'dps':
      return { main: '#ef4444', mid: '#dc2626', light: '#fca5a5' }; // red
    default:
      return { main: '#3b82f6', mid: '#2563eb', light: '#93c5fd' };
  }
}

function getPlayerColorForLevel(level: number, pClass: PlayerClass = 'healer') {
  // Use class color as base
  return getClassColorInternal(pClass);
}

function getPlayerRadiusForLevel(level: number) {
  return PLAYER_R + Math.min(level-1,12)*0.5; // +0.5 per level, capped at +6
}

function getPlayerRadius(){
  return PLAYER_R + Math.min(playerLevel-1,12)*0.5; // +0.5 per level, capped at +6
}

function getGlowIntensity(){
  return Math.min(playerLevel/10, 1.0); // 0.1 at lv1, 1.0 at lv10+
}

function getAttackRange(){
  return ATTACK_RANGE + (playerLevel-1)*2; // slightly bigger slash per level
}

function getDashDist(){
  return DASH_DIST + (playerLevel-1)*5; // slightly more dash per level
}

function hasFullGear(){
  return equipped.weapon && equipped.armor && equipped.accessory;
}

// ─── SPARKLE PARTICLES (full gear set) ───
let sparkleTimer=0;
let sparkleParticles=[];

function gainXP(amount){
  playerXP+=amount;
  let needed=xpToLevel(playerLevel);
  while(playerXP>=needed){
    playerXP-=needed;
    playerLevel++;
    baseMaxHp+=10;baseAtk+=2;baseDef+=1;
    player.maxHp=totalMaxHp();
    player.hp=player.maxHp;
    sfx('levelup');haptic('win');
    
    // Level up overlay animation
    triggerLevelUpOverlay();
    
    // Slow-mo for 3 seconds
    slowMoTimer=3.0;
    
    showPickup('LEVEL UP! Lv '+playerLevel,'#fbbf24');
    // golden particles
    for(let i=0;i<20;i++){
      const a=Math.random()*Math.PI*2,sp=60+Math.random()*120;
      particles.push({x:player.x,y:player.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,maxLife:1,r:3+Math.random()*4,color:'#fbbf24'});
    }
    needed=xpToLevel(playerLevel);
  }
}

function triggerLevelUpOverlay(){
  const overlay=document.getElementById('levelup-overlay');
  const flash=document.getElementById('levelup-flash');
  const text=document.getElementById('levelup-text');
  const stats=document.getElementById('levelup-stats');
  
  overlay.style.display='flex';
  flash.style.opacity='1';
  text.style.animation='none';
  stats.style.animation='none';
  
  // Force reflow
  void text.offsetWidth;
  
  text.style.animation='levelupScale 3s forwards';
  stats.innerHTML=`+10 HP &nbsp; +2 ATK &nbsp; +1 DEF`;
  stats.style.animation='levelupStatsFade 3s forwards';
  
  setTimeout(()=>{flash.style.opacity='0';},300);
  setTimeout(()=>{overlay.style.display='none';text.style.animation='none';stats.style.animation='none';},3000);
}

// ─── LOOT DROPS ───
let lootDrops=[];
let yggdrasilUsed=false; // reset per dungeon run

// ─── CO-OP STATE ───
interface OtherPlayer {
  // rendered (interpolated) position
  x: number; y: number; facingX: number; facingY: number;
  // target from server
  tx: number; ty: number; tfx: number; tfy: number;
  lastUpdate: number;
  // Visual appearance
  name: string;
  level: number;
  playerClass: PlayerClass;
  // Equipment icons
  weaponIcon: string;
  armorIcon: string;
  accessoryIcon: string;
}
let otherPlayers: Map<string, OtherPlayer> = new Map();

// ─── PLAYER MESSAGES (SPEECH BUBBLES) ───
interface ActiveMessage {
  senderIdentity: string;
  senderName: string;
  content: string;
  messageType: string;
  createdAt: number;
  expiresAt: number;
}
let activeMessages: Map<string, ActiveMessage> = new Map();
const MESSAGE_DURATION = 5000; // 5 seconds

// Emote wheel state
let emoteWheelOpen = false;
let emoteButtonHoldTimer: number | null = null;
const EMOTE_HOLD_THRESHOLD = 300; // ms to trigger emote wheel

// Chat input state
let chatInputOpen = false;
let serverEnemyIds: bigint[] = []; // maps local enemy index → server enemy ID
let serverLootMap: Map<string, {id: bigint, x: number, y: number, itemDataJson: string, rarity: string}> = new Map();

// ─── SERVER-AUTHORITATIVE ENEMY STATE (for interpolation) ───
const SERVER_TICK_MS = 50; // Server runs at 20Hz
interface EnemyRenderState {
  serverId: bigint;
  // Current interpolated position
  x: number;
  y: number;
  // Server position for interpolation target
  serverX: number;
  serverY: number;
  // Previous position (for interpolation start)
  prevX: number;
  prevY: number;
  // State from server
  hp: number;
  maxHp: number;
  isAlive: boolean;
  enemyType: string;
  aiState: string;
  stateTimer: number;
  targetX: number;
  targetY: number;
  facingAngle: number;
  packId: bigint | null;
  // Timing
  lastUpdateTime: number;
  // Visual state
  hit: number; // flash on damage
  color: string;
  r: number;
}
let serverEnemyStates: Map<string, EnemyRenderState> = new Map();

function getEnemyVisuals(enemyType: string): { color: string, r: number, eyeColor: string } {
  switch (enemyType) {
    case 'slime': return { color: '#22c55e', r: 12, eyeColor: '#fff' };
    case 'skeleton': return { color: '#e2e8f0', r: 13, eyeColor: '#1a1a2e' };
    case 'archer': return { color: '#a78bfa', r: 12, eyeColor: '#fff' };
    case 'charger': return { color: '#ea580c', r: 14, eyeColor: '#fff' };
    case 'wolf': return { color: '#9ca3af', r: 10, eyeColor: '#fbbf24' };
    case 'bomber': return { color: '#f97316', r: 11, eyeColor: '#fff' };
    case 'necromancer': return { color: '#7e22ce', r: 14, eyeColor: '#a855f7' };
    case 'shield_knight': return { color: '#6b7280', r: 15, eyeColor: '#fff' };
    case 'boss': return { color: '#ef4444', r: 28, eyeColor: '#fbbf24' };
    case 'raid_boss': return { color: '#dc2626', r: 40, eyeColor: '#fbbf24' };
    case 'bat': return { color: '#374151', r: 10, eyeColor: '#ef4444' };
    default: return { color: '#ffffff', r: 12, eyeColor: '#000' };
  }
}

export function updateOtherPlayer(id: string, x: number, y: number, fx: number, fy: number, name: string = 'Player', level: number = 1, pClass: string = 'healer', weaponIcon: string = '', armorIcon: string = '', accessoryIcon: string = '') {
  const existing = otherPlayers.get(id);
  const validClass = (pClass === 'tank' || pClass === 'healer' || pClass === 'dps') ? pClass as PlayerClass : 'healer';
  if (existing) {
    // Move current rendered position to where we are now, set new target
    existing.tx = x; existing.ty = y;
    existing.tfx = fx; existing.tfy = fy;
    existing.lastUpdate = performance.now();
    existing.name = name;
    existing.level = level;
    existing.playerClass = validClass;
    existing.weaponIcon = weaponIcon;
    existing.armorIcon = armorIcon;
    existing.accessoryIcon = accessoryIcon;
  } else {
    otherPlayers.set(id, {x, y, facingX: fx, facingY: fy, tx: x, ty: y, tfx: fx, tfy: fy, lastUpdate: performance.now(), name, level, playerClass: validClass, weaponIcon, armorIcon, accessoryIcon});
  }
}
export function removeOtherPlayer(id: string) {
  otherPlayers.delete(id);
}
function lerpOtherPlayers(dt: number) {
  const LERP_SPEED = 12; // higher = snappier
  otherPlayers.forEach((op) => {
    op.x += (op.tx - op.x) * Math.min(1, LERP_SPEED * dt);
    op.y += (op.ty - op.y) * Math.min(1, LERP_SPEED * dt);
    op.facingX += (op.tfx - op.facingX) * Math.min(1, LERP_SPEED * dt);
    op.facingY += (op.tfy - op.facingY) * Math.min(1, LERP_SPEED * dt);
  });
}
export function getEnemies() { return enemies; }
export function setServerEnemyIds(ids: bigint[]) { serverEnemyIds = ids; }
export function getServerEnemyIds() { return serverEnemyIds; }

// Server and client now use the same TILE size (36) - no conversion needed
function serverToClientX(x: number): number { return x; }
function serverToClientY(y: number): number { return y; }
export function clientToServerX(x: number): number { return x; }
export function clientToServerY(y: number): number { return y; }

// Initialize enemies from server data (called when entering a room)
export function initServerEnemies(serverEnemies: Array<{
  id: bigint, x: number, y: number, hp: number, maxHp: number, isAlive: boolean,
  enemyType: string, aiState: string, stateTimer: number, targetX: number, targetY: number,
  facingAngle: number, packId: bigint | null
}>) {
  serverEnemyStates.clear();
  serverEnemyIds = [];
  const now = performance.now();

  for (const e of serverEnemies) {
    const key = e.id.toString();
    const visuals = getEnemyVisuals(e.enemyType);
    const cx = serverToClientX(e.x), cy = serverToClientY(e.y);
    serverEnemyStates.set(key, {
      serverId: e.id,
      x: cx, y: cy,
      serverX: cx, serverY: cy,
      prevX: cx, prevY: cy,
      hp: e.hp, maxHp: e.maxHp,
      isAlive: e.isAlive,
      enemyType: e.enemyType,
      aiState: e.aiState,
      stateTimer: e.stateTimer,
      targetX: e.targetX, targetY: e.targetY,
      facingAngle: e.facingAngle,
      packId: e.packId,
      lastUpdateTime: now,
      hit: 0,
      color: visuals.color,
      r: visuals.r,
    });
    serverEnemyIds.push(e.id);
  }
  console.log('[Game] Initialized', serverEnemyStates.size, 'server enemies');
}

// Update enemy from server (called on every server tick)
export function syncEnemyFromServer(enemy: {
  id: bigint, x: number, y: number, hp: number, maxHp: number, isAlive: boolean,
  roomIndex: number, enemyType: string, aiState: string, stateTimer: number,
  targetX: number, targetY: number, facingAngle: number, packId: bigint | null
}) {
  // Only process enemies for the current room (treat undefined as matching any room during init)
  if (currentRoom !== undefined && enemy.roomIndex !== currentRoom) {
    return;
  }

  const key = enemy.id.toString();
  const existing = serverEnemyStates.get(key);
  const now = performance.now();

  if (existing) {
    // Check if enemy took damage
    if (enemy.hp < existing.hp) {
      existing.hit = 0.15;
      // Damage number
      dmgNumbers.push({
        x: existing.x, y: existing.y - existing.r,
        val: existing.hp - enemy.hp,
        life: 0.8, vy: -60, color: '#fbbf24'
      });
    }

    // Check if enemy died
    if (!enemy.isAlive && existing.isAlive) {
      // Death particles
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 80;
        particles.push({
          x: existing.x, y: existing.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.6, maxLife: 0.6,
          r: 3 + Math.random() * 4,
          color: existing.color
        });
      }
    }

    // Shift position: current server → prev, new server → current server (scaled)
    existing.prevX = existing.serverX;
    existing.prevY = existing.serverY;
    existing.serverX = serverToClientX(enemy.x);
    existing.serverY = serverToClientY(enemy.y);
    existing.hp = enemy.hp;
    existing.maxHp = enemy.maxHp;
    existing.isAlive = enemy.isAlive;
    existing.aiState = enemy.aiState;
    existing.stateTimer = enemy.stateTimer;
    existing.targetX = enemy.targetX;
    existing.targetY = enemy.targetY;
    existing.facingAngle = enemy.facingAngle;
    existing.lastUpdateTime = now;
  } else {
    // New enemy (spawned by necromancer, etc.)
    const visuals = getEnemyVisuals(enemy.enemyType);
    const cx = serverToClientX(enemy.x), cy = serverToClientY(enemy.y);
    serverEnemyStates.set(key, {
      serverId: enemy.id,
      x: cx, y: cy,
      serverX: cx, serverY: cy,
      prevX: cx, prevY: cy,
      hp: enemy.hp, maxHp: enemy.maxHp,
      isAlive: enemy.isAlive,
      enemyType: enemy.enemyType,
      aiState: enemy.aiState,
      stateTimer: enemy.stateTimer,
      targetX: enemy.targetX, targetY: enemy.targetY,
      facingAngle: enemy.facingAngle,
      packId: enemy.packId,
      lastUpdateTime: now,
      hit: 0,
      color: visuals.color,
      r: visuals.r,
    });
    if (!serverEnemyIds.includes(enemy.id)) {
      serverEnemyIds.push(enemy.id);
    }
  }
}

// Remove enemy from tracking
export function removeServerEnemy(id: bigint) {
  const key = id.toString();
  serverEnemyStates.delete(key);
  serverEnemyIds = serverEnemyIds.filter(eid => eid !== id);
}

// Get interpolated position for smooth rendering
function getInterpolatedEnemyPosition(state: EnemyRenderState): { x: number, y: number } {
  const elapsed = performance.now() - state.lastUpdateTime;

  // If too much time has passed (lag), snap to server position
  if (elapsed > SERVER_TICK_MS * 3) {
    return { x: state.serverX, y: state.serverY };
  }

  // Interpolate between previous and current server positions
  const t = Math.min(elapsed / SERVER_TICK_MS, 1.0);
  return {
    x: state.prevX + (state.serverX - state.prevX) * t,
    y: state.prevY + (state.serverY - state.prevY) * t,
  };
}

// Update interpolated positions (called every frame)
function updateServerEnemyInterpolation() {
  serverEnemyStates.forEach((state) => {
    if (!state.isAlive) return;
    const pos = getInterpolatedEnemyPosition(state);
    state.x = pos.x;
    state.y = pos.y;
    // Decay hit flash
    if (state.hit > 0) state.hit -= 0.016; // ~60fps
  });
}

// Get all server enemies for rendering
function getServerEnemiesForRender(): EnemyRenderState[] {
  return Array.from(serverEnemyStates.values());
}

// Legacy sync function (for backwards compatibility)
export function syncEnemyHp(updates: Array<{id: bigint, hp: number, isAlive: boolean}>) {
  for (const u of updates) {
    const key = u.id.toString();
    const state = serverEnemyStates.get(key);
    if (state) {
      if (!u.isAlive && state.isAlive) {
        // death particles
        for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2;const sp=40+Math.random()*60;particles.push({x:state.x,y:state.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.5,maxLife:0.5,r:3,color:state.color});}
      } else if (u.hp < state.hp) {
        state.hit = 0.1;
      }
      state.hp = u.hp;
      state.isAlive = u.isAlive;
    }
  }
}
export function addServerLoot(loot: {id: bigint, x: number, y: number, itemDataJson: string, rarity: string}) {
  console.log('[Game] addServerLoot called:', { id: loot.id.toString(), x: loot.x, y: loot.y, rarity: loot.rarity, itemDataJson: loot.itemDataJson });
  const key = loot.id.toString();
  if (serverLootMap.has(key)) return;
  serverLootMap.set(key, loot);

  // Scale server coordinates to client coordinates
  const clientX = serverToClientX(loot.x);
  const clientY = serverToClientY(loot.y);

  // Parse item data to get enemy source type
  let enemyType = 'slime'; // Default
  try {
    const itemData = JSON.parse(loot.itemDataJson);
    if (itemData.source) {
      enemyType = itemData.source;
    }
  } catch (e) {
    console.warn('[Game] Failed to parse loot itemDataJson:', e);
  }

  // Get drop table for this enemy type
  const table = DROP_TABLES[enemyType] || DROP_TABLES.slime;
  const slot = pickSlotFromTable(table);

  // Generate proper gear based on rarity
  const isBoss = enemyType === 'boss';
  const gear = generateGear(slot, dungeonDepth, isBoss);
  console.log('[Game] Generated gear:', { enemyType, slot, gearName: gear.name, gearRarity: gear.rarity, icon: gear.icon });

  // Override rarity if server specifies it
  if (loot.rarity) {
    gear.rarity = loot.rarity;
    gear.rarityColor = loot.rarity === 'rare' ? '#3b82f6' :
                       loot.rarity === 'uncommon' ? '#22c55e' :
                       loot.rarity === 'epic' ? '#a855f7' :
                       loot.rarity === 'legendary' ? '#f97316' : '#fff';
  }

  // Add to lootDrops for rendering
  console.log('[Game] Adding loot at coords:', { x: clientX, y: clientY });
  lootDrops.push({
    x: clientX,
    y: clientY,
    type: 'gear',
    gear,
    glow: 0,
    icon: gear.icon,
    bouncing: false,
    _serverLootId: loot.id,
  });
}
export function removeServerLoot(id: bigint) {
  const key = id.toString();
  serverLootMap.delete(key);
  lootDrops = lootDrops.filter(l => !l._serverLootId || l._serverLootId.toString() !== key);
}
export function syncRoom(roomIndex: number) {
  if (roomIndex === currentRoom) return;
  serverLootMap.clear();  // Clear stale loot from previous room
  serverEnemyStates.clear();  // Clear stale enemies from previous room
  serverEnemyIds = [];
  goToRoom(roomIndex, roomIndex > currentRoom ? 'top' : 'bottom');
}
export function getCurrentRoom() { return currentRoom; }

function spawnLoot(x,y,enemyType){
  const table=DROP_TABLES[enemyType]||DROP_TABLES.slime;
  const isBoss=enemyType==='boss';
  const gs=getGearStats();
  const goldMult=1+(gs.goldBonus||0)/100;
  
  // Gold drops — scatter as multiple coins
  const goldAmt=Math.ceil((table.goldRange[0]+Math.floor(Math.random()*(table.goldRange[1]-table.goldRange[0])))*goldMult);
  const numCoins=isBoss?5+Math.floor(Math.random()*4):2+Math.floor(Math.random()*2);
  for(let i=0;i<numCoins;i++){
    const coinAmt=Math.ceil(goldAmt/numCoins);
    const angle=Math.random()*Math.PI*2;
    const dist=10+Math.random()*25;
    lootDrops.push({x:x+Math.cos(angle)*dist,y:y+Math.sin(angle)*dist,type:'gold',amount:coinAmt,
      glow:0,icon:'💰',vy:-80-Math.random()*60,vx:(Math.random()-0.5)*80,bouncing:true,groundY:y+Math.sin(angle)*dist+10});
  }

  // Gear drops
  const numDrops=isBoss?(table.numDrops[0]+Math.floor(Math.random()*(table.numDrops[1]-table.numDrops[0]+1))):1;
  for(let d=0;d<numDrops;d++){
    if(Math.random()<table.gearChance){
      const slot=pickSlotFromTable(table);
      const gear=generateGear(slot,dungeonDepth,isBoss);
      const angle=Math.random()*Math.PI*2;
      const dist=15+Math.random()*30;
      const drop={x:x+Math.cos(angle)*dist,y:y+Math.sin(angle)*dist,type:'gear',gear,
        glow:0,icon:gear.icon,vy:-100-Math.random()*60,vx:(Math.random()-0.5)*60,
        bouncing:true,groundY:y+Math.sin(angle)*dist+5};
      lootDrops.push(drop);
      
      // Legendary drop effects!
      if(gear.rarity==='legendary'){
        triggerLegendaryDropEffect(drop);
      }
    }
  }

  // Card drop
  if(table.cardChance&&Math.random()<table.cardChance){
    const cardType=enemyType;
    if(CARD_DEFS[cardType]){
      const card=CARD_DEFS[cardType];
      const angle=Math.random()*Math.PI*2;
      const dist=10+Math.random()*20;
      lootDrops.push({x:x+Math.cos(angle)*dist,y:y+Math.sin(angle)*dist,type:'card',cardType,
        glow:0,icon:'🃏',vy:-90-Math.random()*50,vx:(Math.random()-0.5)*60,
        bouncing:true,groundY:y+Math.sin(angle)*dist+5});
    }
  }
}

function triggerLegendaryDropEffect(drop){
  // Screen flash
  const flash=document.getElementById('legendary-flash');
  flash.style.display='block';flash.style.animation='none';
  void flash.offsetWidth;
  flash.style.animation='legendaryFlash 0.5s forwards';
  setTimeout(()=>{flash.style.display='none';},600);
  // Haptic
  haptic('heavy');
  try{navigator.vibrate&&navigator.vibrate([50,30,50,30,100,50,150]);}catch(e){}
  // SFX — epic chord
  sfxLegendaryDrop();
}

function sfxLegendaryDrop(){
  initAudio();if(!audioCtx)return;
  const t=audioCtx.currentTime;
  [400,500,600,800,1000,1200].forEach((f,i)=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(audioCtx.destination);
    o.type='sine';o.frequency.setValueAtTime(f,t+i*0.08);
    g.gain.setValueAtTime(0.15,t+i*0.08);g.gain.exponentialRampToValueAtTime(0.01,t+i*0.08+0.4);
    o.start(t+i*0.08);o.stop(t+i*0.08+0.4);
  });
}

function showPickup(text,color){
  const el=document.createElement('div');
  el.className='pickup-note';
  el.textContent=text;
  el.style.color=color||'#fff';
  document.getElementById('pickup-notifications').appendChild(el);
  setTimeout(()=>el.remove(),1500);
}

// ─── ROOMS ───
const ROOM_W = 15, ROOM_H = 21;
function makeRoom(){
  const r=[];
  for(let y=0;y<ROOM_H;y++){const row=[];for(let x=0;x<ROOM_W;x++){
    if(y===0||y===ROOM_H-1||x===0||x===ROOM_W-1)row.push(1);else row.push(0);
  }r.push(row)}return r;
}
function addDoor(r,side){
  if(side==='top'){r[0][7]=2;}
  if(side==='bottom'){r[ROOM_H-1][7]=2;}
}

// ─── RANDOM DUNGEON GENERATION ───
let dungeonRooms=[];

function generateDungeon(depth){
  // Fixed 4-room structure:
  // Room 0: Basic (Training) - slimes, skeletons
  // Room 1: Tactical (Chamber) - archers, chargers + mini-boss (Shield Knight)
  // Room 2: Complex (Gauntlet) - necromancers, bombers, wolf packs
  // Room 3: Raid (Arena) - raid boss only (requires 2+ players)
  const roomDefs = [
    {
      name: '⚔️ Training Grounds',
      enemies: [{type:'slime',x:5,y:8},{type:'slime',x:9,y:8},{type:'skeleton',x:7,y:12},{type:'bat',x:7,y:5}],
      doors: ['bottom'],
      isBoss: false,
      isRaid: false
    },
    {
      name: '🏛️ Tactical Chamber',
      enemies: [{type:'archer',x:3,y:6},{type:'charger',x:11,y:6},{type:'skeleton',x:7,y:10},{type:'shield_knight',x:7,y:14}],
      doors: ['top','bottom'],
      isBoss: false,
      isRaid: false
    },
    {
      name: '💀 The Gauntlet',
      enemies: [{type:'wolf',x:4,y:8},{type:'wolf',x:10,y:8},{type:'necromancer',x:7,y:6},{type:'bomber',x:7,y:14}],
      doors: ['top','bottom'],
      isBoss: false,
      isRaid: false
    },
    {
      name: '🔥 RAID ARENA 🔥',
      enemies: [{type:'raid_boss',x:7,y:10}],
      doors: ['top'],
      isBoss: true,
      isRaid: true
    }
  ];
  return roomDefs;
}

// ─── STATE ───
let canvas,ctx,W,H,minimapCtx;
let gameStarted=false, gameOver=false, gameDead=false, inHub=false;
let player,camera,rooms,currentRoom,particles,dmgNumbers,enemies;
let joystickActive=false,joystickTouchId=null,joyVec={x:0,y:0};
let abilities={attack:{cd:0,maxCd:ATTACK_CD},dash:{cd:0,maxCd:DASH_CD},ability1:{cd:0,maxCd:8},ability2:{cd:0,maxCd:12}};
let shakeTimer=0,shakeIntensity=0;
let roomTransition=0,roomTransAlpha=0;
let lastTime=0;

// ─── HUB AMBIENT PARTICLES ───
let hubParticles=[];
let hubAnimFrame=null;

function startHubAmbient(){
  const hc=document.getElementById('hub-character-canvas') as HTMLCanvasElement;
  const hctx=hc.getContext('2d');
  hubParticles=[];
  for(let i=0;i<30;i++){
    hubParticles.push({
      x:Math.random()*160,y:Math.random()*160,
      vx:(Math.random()-0.5)*0.3,vy:-0.2-Math.random()*0.3,
      r:1+Math.random()*2,alpha:Math.random(),
      color:['#fbbf24','#a78bfa','#60a5fa','#fff'][Math.floor(Math.random()*4)]
    });
  }
  function drawHubChar(){
    hctx.clearRect(0,0,160,160);
    
    // Ambient particles
    hubParticles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      p.alpha+=Math.sin(Date.now()*0.003+p.x)*0.01;
      if(p.y<-5){p.y=165;p.x=Math.random()*160;}
      if(p.x<-5||p.x>165){p.x=Math.random()*160;}
      hctx.globalAlpha=Math.max(0,Math.min(1,p.alpha*0.4));
      hctx.fillStyle=p.color;
      hctx.beginPath();hctx.arc(p.x,p.y,p.r,0,Math.PI*2);hctx.fill();
    });
    hctx.globalAlpha=1;
    
    const cx=80,cy=80;
    const colors=getPlayerColor();
    const pr=getPlayerRadius()*2; // bigger for hub display
    const glowI=getGlowIntensity();
    
    // Glow ring
    if(glowI>0.05){
      const gradient=hctx.createRadialGradient(cx,cy,pr,cx,cy,pr+15+glowI*10);
      gradient.addColorStop(0,`rgba(251,191,36,${glowI*0.5})`);
      gradient.addColorStop(1,'rgba(251,191,36,0)');
      hctx.fillStyle=gradient;
      hctx.beginPath();hctx.arc(cx,cy,pr+15+glowI*10,0,Math.PI*2);hctx.fill();
    }
    
    // Shadow
    hctx.fillStyle='rgba(0,0,0,0.3)';
    hctx.beginPath();hctx.ellipse(cx,cy+pr+4,pr,pr*0.3,0,0,Math.PI*2);hctx.fill();
    
    // Body
    hctx.fillStyle=colors.main;
    hctx.beginPath();hctx.arc(cx,cy,pr,0,Math.PI*2);hctx.fill();
    hctx.fillStyle=colors.mid;
    hctx.beginPath();hctx.arc(cx,cy+2,pr-3,0,Math.PI*2);hctx.fill();
    hctx.fillStyle=colors.main;
    hctx.beginPath();hctx.arc(cx,cy-1,pr-5,0,Math.PI*2);hctx.fill();
    
    // Eyes
    hctx.fillStyle='#fff';
    hctx.beginPath();hctx.arc(cx-6,cy-3,5,0,Math.PI*2);hctx.fill();
    hctx.beginPath();hctx.arc(cx+6,cy-3,5,0,Math.PI*2);hctx.fill();
    hctx.fillStyle='#1e293b';
    hctx.beginPath();hctx.arc(cx-5,cy-3,2.5,0,Math.PI*2);hctx.fill();
    hctx.beginPath();hctx.arc(cx+7,cy-3,2.5,0,Math.PI*2);hctx.fill();
    
    // Equipped gear icons floating around
    const gearIcons=[];
    if(equipped.weapon) gearIcons.push(equipped.weapon.icon);
    if(equipped.armor) gearIcons.push(equipped.armor.icon);
    if(equipped.accessory) gearIcons.push(equipped.accessory.icon);
    gearIcons.forEach((icon,i)=>{
      const angle=-Math.PI/2+i*(Math.PI*2/3)+Date.now()*0.001;
      const gx=cx+Math.cos(angle)*(pr+18);
      const gy=cy+Math.sin(angle)*(pr+18);
      hctx.font='16px system-ui';hctx.textAlign='center';hctx.textBaseline='middle';
      hctx.fillText(icon,gx,gy);
    });
    
    // Full gear sparkle
    if(hasFullGear()){
      for(let i=0;i<3;i++){
        const sa=Date.now()*0.002+i*2.1;
        const sx=cx+Math.cos(sa)*(pr+8+Math.sin(Date.now()*0.005+i)*5);
        const sy=cy+Math.sin(sa)*(pr+8+Math.cos(Date.now()*0.004+i)*5);
        hctx.globalAlpha=0.5+Math.sin(Date.now()*0.008+i)*0.3;
        hctx.fillStyle='#fbbf24';
        hctx.beginPath();hctx.arc(sx,sy,1.5,0,Math.PI*2);hctx.fill();
      }
      hctx.globalAlpha=1;
    }
    
    hubAnimFrame=requestAnimationFrame(drawHubChar);
  }
  drawHubChar();
}

function stopHubAmbient(){
  if(hubAnimFrame){cancelAnimationFrame(hubAnimFrame);hubAnimFrame=null;}
}

// ─── INIT ───
function init(){
  canvas=document.getElementById('game') as HTMLCanvasElement;
  ctx=canvas.getContext('2d');
  minimapCtx=(document.getElementById('minimap') as HTMLCanvasElement).getContext('2d');
  resize();
  window.addEventListener('resize',resize);
  setupTouch();
  setupKeyboard();
  document.getElementById('btn-start').addEventListener('click',startGame);
  document.getElementById('btn-restart').addEventListener('click',()=>{document.getElementById('screen-overlay').style.display='none';showHub();});
  document.getElementById('btn-retry').addEventListener('click',()=>{document.getElementById('death-screen').style.display='none';showHub();});
  document.getElementById('btn-attack').addEventListener('touchstart',e=>{e.preventDefault();doAttack();});
  document.getElementById('btn-attack').addEventListener('click',doAttack);
  document.getElementById('btn-dash').addEventListener('touchstart',e=>{e.preventDefault();doDash();});
  document.getElementById('btn-dash').addEventListener('click',doDash);
  document.getElementById('btn-ability1').addEventListener('touchstart',e=>{e.preventDefault();doAbility1();});
  document.getElementById('btn-ability1').addEventListener('click',doAbility1);
  document.getElementById('btn-ability2').addEventListener('touchstart',e=>{e.preventDefault();doAbility2();});
  document.getElementById('btn-ability2').addEventListener('click',doAbility2);

  // Emote button - long press for wheel, tap for quick chat
  setupEmoteButton();
  setupChatInput();
  document.getElementById('btn-enter-dungeon').addEventListener('click',enterDungeon);
  document.getElementById('bag-btn').addEventListener('click',openInventory);
  document.getElementById('stats-btn').addEventListener('click',openStats);
  document.getElementById('inv-close').addEventListener('click',closeInventory);
  document.getElementById('stats-close').addEventListener('click',closeStats);
  document.getElementById('btn-hub-inventory').addEventListener('click',openInventory);
  requestAnimationFrame(loop);
}

let gameScale=1;
let gameOffsetX=0;
let gameOffsetY=0;

// Fixed game dimensions (mobile portrait 9:16 aspect ratio)
const GAME_WIDTH = ROOM_W * TILE;  // 540px
const GAME_HEIGHT = ROOM_H * TILE; // 720px

function resize(){
  const dpr=window.devicePixelRatio||1;
  W=window.innerWidth;H=window.innerHeight;

  // Calculate scale to fit game in window while maintaining aspect ratio
  const scaleX = W / GAME_WIDTH;
  const scaleY = H / GAME_HEIGHT;
  gameScale = Math.min(scaleX, scaleY);

  // Center the game with letterboxing
  gameOffsetX = (W - GAME_WIDTH * gameScale) / 2;
  gameOffsetY = (H - GAME_HEIGHT * gameScale) / 2;

  canvas.width=W*dpr;canvas.height=H*dpr;
  ctx.setTransform(dpr*gameScale,0,0,dpr*gameScale,dpr*gameOffsetX,dpr*gameOffsetY);
}

function showHub(){
  inHub=true;gameStarted=false;gameOver=false;gameDead=false;

  // Display class icon and level
  const classInfo = CLASS_STATS[playerClass];
  document.getElementById('hub-hero-level').textContent=`${classInfo.icon} Level ${playerLevel} ${playerClass.toUpperCase()}`;
  document.getElementById('hub-atk').textContent=String(totalAtk());
  document.getElementById('hub-def').textContent=String(totalDef());
  document.getElementById('hub-hp').textContent=String(totalMaxHp());

  let info=`💰 <span>${gold}</span> Gold &nbsp;·&nbsp; Dungeon Depth: <span>${dungeonDepth}</span>`;
  document.getElementById('hub-info').innerHTML=info;
  
  // Gear slots
  const gearDiv=document.getElementById('hub-gear-slots');
  gearDiv.innerHTML='';
  ['weapon','armor','accessory'].forEach(slot=>{
    const item=equipped[slot];
    const el=document.createElement('div');
    el.className='hub-gear-slot';
    if(item){
      el.style.borderColor=item.rarityColor;
      el.innerHTML=`<div class="item-icon">${item.icon}</div><div class="item-name" style="color:${item.rarityColor}">${item.name}</div>`;
    }else{
      el.innerHTML=`<div class="item-icon" style="opacity:0.3">—</div><div class="item-name">${slot}</div>`;
    }
    gearDiv.appendChild(el);
  });
  
  document.getElementById('hub-screen').style.display='flex';
  startHubAmbient();
}

function enterDungeon(){
  stopHubAmbient();
  document.getElementById('hub-screen').style.display='none';
  inHub=false;
  resetGame();
  callbacks.onStartDungeon?.();
}

function resetGame(){
  player={x:7*TILE+TILE/2,y:17*TILE+TILE/2,hp:totalMaxHp(),maxHp:totalMaxHp(),r:PLAYER_R,vx:0,vy:0,speed:totalSpeed(),facing:{x:0,y:-1},dashing:false,dashTimer:0,dashDir:{x:0,y:0},invincible:0,attackAnim:0};
  camera={x:0,y:0};
  currentRoom=0;
  particles=[];
  dmgNumbers=[];
  enemies=[];
  lootDrops=[];
  projectiles=[];
  sparkleParticles=[];
  otherPlayers.clear();
  serverEnemyStates.clear(); // Clear server enemy state - will be populated from server
  serverEnemyIds = [];
  serverLootMap.clear(); // Clear stale loot from previous dungeon
  abilities.attack.cd=0;abilities.dash.cd=0;abilities.ability1.cd=0;abilities.ability2.cd=0;
  gameOver=false;gameDead=false;
  slowMoTimer=0;
  yggdrasilUsed=false;
  dungeonRooms=generateDungeon(dungeonDepth);
  rooms=dungeonRooms.map(d=>{const m=makeRoom();d.doors.forEach(s=>addDoor(m,s));return m;});
  // Enemies come from server - don't spawn locally
  showRoomLabel(dungeonRooms[0].name);
  document.getElementById('depth-display').textContent='Run '+dungeonDepth;
  gameStarted=true;
}

function startGame(){
  initAudio();
  document.getElementById('start-screen').style.display='none';
  showHub();
}

// ─── STATS PANEL ───
function openStats(){
  renderStats();
  document.getElementById('stats-panel').style.display='flex';
}
function closeStats(){
  document.getElementById('stats-panel').style.display='none';
}
function renderStats(){
  const gs=getGearStats();
  const content=document.getElementById('stats-content');
  let html='';
  
  html+=`<div class="stats-section"><h3>Character</h3>`;
  html+=`<div class="stat-row"><span class="stat-name">Level</span><span class="stat-value">${playerLevel}</span></div>`;
  html+=`<div class="stat-row"><span class="stat-name">XP</span><span class="stat-value">${playerXP} / ${xpToLevel(playerLevel)}</span></div>`;
  html+=`</div>`;
  
  html+=`<div class="stats-section"><h3>Combat Stats</h3>`;
  const atkBase=BASE_ATTACK_DMG+baseAtk;
  const atkGear=gs.ATK;
  html+=`<div class="stat-row"><span class="stat-name">ATK</span><span class="stat-value">${atkBase+atkGear}${atkGear?` <span class="stat-bonus">(+${atkGear})</span>`:''}</span></div>`;
  const defBase=baseDef;
  const defGear=gs.DEF;
  html+=`<div class="stat-row"><span class="stat-name">DEF</span><span class="stat-value">${defBase+defGear}${defGear?` <span class="stat-bonus">(+${defGear})</span>`:''}</span></div>`;
  const hpBase=baseMaxHp;
  const hpGear=gs.HP;
  html+=`<div class="stat-row"><span class="stat-name">HP</span><span class="stat-value">${hpBase+hpGear}${hpGear?` <span class="stat-bonus">(+${hpGear})</span>`:''}</span></div>`;
  const spdBase=160+baseSpeed;
  const spdGear=gs.Speed*10;
  html+=`<div class="stat-row"><span class="stat-name">Speed</span><span class="stat-value">${spdBase+spdGear}${spdGear?` <span class="stat-bonus">(+${spdGear})</span>`:''}</span></div>`;
  if(gs.crit)html+=`<div class="stat-row"><span class="stat-name">Crit %</span><span class="stat-value">${gs.crit+(hasPassive('odinsEye')?15:0)}<span class="stat-bonus">%</span></span></div>`;
  if(gs.lifesteal)html+=`<div class="stat-row"><span class="stat-name">Lifesteal</span><span class="stat-value">${gs.lifesteal}<span class="stat-bonus">%</span></span></div>`;
  if(gs.reflect)html+=`<div class="stat-row"><span class="stat-name">Reflect</span><span class="stat-value">${gs.reflect}</span></div>`;
  if(gs.goldBonus)html+=`<div class="stat-row"><span class="stat-name">Gold Bonus</span><span class="stat-value">${gs.goldBonus}<span class="stat-bonus">%</span></span></div>`;
  if(gs.dropRate)html+=`<div class="stat-row"><span class="stat-name">Drop Rate</span><span class="stat-value">${gs.dropRate}<span class="stat-bonus">%</span></span></div>`;
  html+=`</div>`;
  
  // Equipped passives
  const passives=getEquippedPassives();
  if(passives.length>0){
    html+=`<div class="stats-section"><h3>Legendary Passives</h3>`;
    for(let sl in equipped){
      if(equipped[sl]&&equipped[sl].passive){
        html+=`<div class="stat-row"><span class="stat-name" style="color:#f97316">${equipped[sl].name}</span><span class="stat-value" style="font-size:11px;color:#f97316">${equipped[sl].passive}</span></div>`;
      }
    }
    html+=`</div>`;
  }
  
  // Cards
  if(cardInventory.length>0){
    html+=`<div class="stats-section"><h3>Cards Owned</h3>`;
    cardInventory.forEach(ct=>{const cd=CARD_DEFS[ct];if(cd)html+=`<div class="stat-row"><span class="stat-name">${cd.icon} ${cd.name}</span><span class="stat-value" style="color:#a855f7">${cd.desc}</span></div>`;});
    html+=`</div>`;
  }
  
  html+=`<div class="stats-section"><h3>Lifetime</h3>`;
  html+=`<div class="stat-row"><span class="stat-name">Enemies Killed</span><span class="stat-value">${lifetimeKills}</span></div>`;
  html+=`<div class="stat-row"><span class="stat-name">Dungeons Cleared</span><span class="stat-value">${lifetimeDungeons}</span></div>`;
  html+=`<div class="stat-row"><span class="stat-name">Gold Earned</span><span class="stat-value">${lifetimeGold}</span></div>`;
  html+=`</div>`;
  
  content.innerHTML=html;
}

// ─── INVENTORY UI ───
function openInventory(){
  renderInventory();
  document.getElementById('inventory-panel').style.display='flex';
}
function closeInventory(){
  document.getElementById('inventory-panel').style.display='none';
}

let longPressTimer=null;
let invSortMode='default'; // default, rarity, slot

function renderInventory(){
  const eqDiv=document.getElementById('equipped-slots');
  eqDiv.innerHTML='';
  ['weapon','armor','accessory'].forEach(slot=>{
    const item=equipped[slot];
    const el=document.createElement('div');
    el.className='inv-slot'+(item?' rarity-'+item.rarity:' empty');
    if(item){
      let extra='';
      if(item.cardSlot){const cd=CARD_DEFS[item.cardSlot];extra=`<div class="card-indicator">${cd?cd.icon:'🃏'}</div>`;}
      el.innerHTML=`<div class="item-icon">${item.icon}</div><div class="item-name" style="color:${item.rarityColor}">${item.name}</div>${extra}`;
      el.addEventListener('click',()=>showItemTooltip(item,'equipped',slot));
    }else{
      el.innerHTML=`<div class="item-icon" style="opacity:0.3">—</div><div class="item-name">${slot}</div>`;
    }
    eqDiv.appendChild(el);
  });
  
  // Sort bar
  let sortBar=document.querySelector('.inv-sort-bar');
  if(!sortBar){
    sortBar=document.createElement('div');
    sortBar.className='inv-sort-bar';
    const bpSection=document.querySelector('#inventory-panel .inv-section:last-child');
    bpSection.insertBefore(sortBar,bpSection.querySelector('.inv-slots'));
  }
  sortBar.innerHTML='';
  ['default','rarity','slot'].forEach(mode=>{
    const btn=document.createElement('button');
    btn.textContent=mode==='default'?'Order':mode==='rarity'?'By Rarity':'By Slot';
    if(invSortMode===mode)btn.className='active';
    btn.addEventListener('click',()=>{invSortMode=mode;renderInventory();});
    sortBar.appendChild(btn);
  });
  
  // Sort backpack
  let sorted=[...backpack];
  if(invSortMode==='rarity'){
    const order={legendary:0,epic:1,rare:2,uncommon:3,common:4};
    sorted.sort((a,b)=>(order[a.rarity]||5)-(order[b.rarity]||5));
  }else if(invSortMode==='slot'){
    const order={weapon:0,armor:1,accessory:2};
    sorted.sort((a,b)=>(order[a.slot]||3)-(order[b.slot]||3));
  }
  
  // Cards section
  let cardSection=document.getElementById('card-section');
  if(!cardSection){
    cardSection=document.createElement('div');
    cardSection.className='inv-section';
    cardSection.id='card-section';
    document.getElementById('inventory-panel').appendChild(cardSection);
  }
  if(cardInventory.length>0){
    cardSection.innerHTML='<h3>🃏 Cards</h3><div class="inv-slots" id="card-slots"></div>';
    const cardDiv=cardSection.querySelector('#card-slots');
    cardInventory.forEach((cardType,i)=>{
      const cd=CARD_DEFS[cardType];
      if(!cd)return;
      const el=document.createElement('div');
      el.className='inv-slot rarity-epic';
      el.innerHTML=`<div class="item-icon">${cd.icon}</div><div class="item-name" style="color:#a855f7">${cd.name}</div>`;
      el.addEventListener('click',()=>showCardInfo(cardType,i));
      cardDiv.appendChild(el);
    });
  }else{
    cardSection.innerHTML='';
  }
  
  const bpDiv=document.getElementById('backpack-slots');
  bpDiv.innerHTML='';
  for(let i=0;i<16;i++){
    const item=sorted[i];
    const el=document.createElement('div');
    el.className='inv-slot'+(item?' rarity-'+item.rarity:' empty');
    if(item){
      let extra='';
      if(item.isNew)extra+=`<div class="new-badge">NEW</div>`;
      if(item.cardSlot){const cd=CARD_DEFS[item.cardSlot];extra+=`<div class="card-indicator">${cd?cd.icon:'🃏'}</div>`;}
      el.innerHTML=`<div class="item-icon">${item.icon}</div><div class="item-name" style="color:${item.rarityColor}">${item.name}</div>${extra}`;
      const origIdx=backpack.indexOf(item);
      el.addEventListener('click',()=>showItemTooltip(item,'backpack',origIdx));
    }else{
      el.innerHTML=`<div class="item-icon" style="opacity:0.15">·</div>`;
    }
    bpDiv.appendChild(el);
  }
}

function showItemTooltip(item,location,slotOrIdx){
  item.isNew=false;
  const tt=document.getElementById('item-tooltip');
  tt.style.borderColor=item.rarityColor;
  let html=`<div class="tt-name" style="color:${item.rarityColor}">${item.icon} ${item.name}</div>`;
  html+=`<div class="tt-rarity" style="color:${item.rarityColor}">${item.rarity} ${item.slot}</div>`;
  html+=`<div class="tt-ilvl">Item Level: ${item.ilvl||1}</div>`;
  
  // Stats
  html+=`<div class="tt-stats">`;
  const cs=getComputedStats(item);
  for(const[k,v]of Object.entries(cs)){
    if(v>0){
      const label=k==='crit'?'Crit%':k==='lifesteal'?'Lifesteal':k==='reflect'?'Reflect':k==='dropRate'?'Drop Rate%':k==='goldBonus'?'Gold Bonus%':k;
      html+=`<div class="tt-stat positive">+${v} ${label}</div>`;
    }
  }
  html+=`</div>`;
  
  // Affixes
  if(item.affixes&&item.affixes.length>0){
    html+=`<div class="tt-affixes">`;
    item.affixes.forEach(a=>{
      const pctLabel=a.pct?'%':'';
      html+=`<div class="tt-affix">✦ ${a.name}: +${a.value}${pctLabel} ${a.stat}</div>`;
    });
    html+=`</div>`;
  }
  
  // Passive
  if(item.passive){
    html+=`<div class="tt-passive">★ ${item.passive}</div>`;
  }
  
  // Card slot
  if(item.cardSlot){
    const cd=CARD_DEFS[item.cardSlot];
    html+=`<div class="tt-card">${cd.icon} ${cd.name}: ${cd.desc}</div>`;
  }else{
    html+=`<div class="tt-card empty">◇ Empty card slot</div>`;
  }
  
  // Compare with equipped
  if(location==='backpack'){
    const current=equipped[item.slot];
    if(current){
      html+=`<div class="tt-compare"><b>vs Equipped: ${current.name}</b><br>`;
      const curStats=getComputedStats(current);
      const newStats=cs;
      for(const k of['ATK','DEF','HP','Speed','crit','lifesteal']){
        const diff=(newStats[k]||0)-(curStats[k]||0);
        if(diff!==0){
          const cls=diff>0?'better':'worse';
          const sign=diff>0?'+':'';
          html+=`<span class="${cls}">${sign}${diff} ${k}</span> `;
        }
      }
      html+=`</div>`;
    }
  }
  
  // Actions
  html+=`<div class="tt-actions">`;
  if(location==='backpack'){
    html+=`<button class="tt-btn-equip" onclick="equipFromBackpack(${slotOrIdx});closeTooltip();renderInventory();">Equip</button>`;
    if(cardInventory.length>0&&!item.cardSlot){
      html+=`<button class="tt-btn-card" onclick="openCardSlotModal('${item.id}');closeTooltip();">Slot Card</button>`;
    }
    html+=`<button class="tt-btn-discard" onclick="discardFromBackpack(${slotOrIdx});closeTooltip();renderInventory();">Discard</button>`;
  }else{
    html+=`<button class="tt-btn-unequip" onclick="unequipItem('${slotOrIdx}');closeTooltip();renderInventory();">Unequip</button>`;
    if(cardInventory.length>0&&!item.cardSlot){
      html+=`<button class="tt-btn-card" onclick="openCardSlotModal('${item.id}');closeTooltip();">Slot Card</button>`;
    }
  }
  html+=`<button class="tt-btn-close" onclick="closeTooltip()">Close</button>`;
  html+=`</div>`;
  
  tt.innerHTML=html;
  tt.style.display='block';
}

function closeTooltip(){document.getElementById('item-tooltip').style.display='none';}

function showCardInfo(cardType,idx){
  const cd=CARD_DEFS[cardType];
  const tt=document.getElementById('item-tooltip');
  tt.style.borderColor='#a855f7';
  tt.innerHTML=`
    <div class="tt-name" style="color:#a855f7">${cd.icon} ${cd.name}</div>
    <div class="tt-rarity" style="color:#a855f7">CARD</div>
    <div class="tt-stats"><div class="tt-stat positive">${cd.desc}</div></div>
    <div style="color:#94a3b8;font-size:12px;margin-top:6px">Slot into any gear piece for its bonus.</div>
    <div class="tt-actions">
      <button class="tt-btn-discard" onclick="discardCard(${idx});closeTooltip();renderInventory();">Discard</button>
      <button class="tt-btn-close" onclick="closeTooltip()">Close</button>
    </div>`;
  tt.style.display='block';
}

function openCardSlotModal(itemId){
  const modal=document.getElementById('card-slot-modal');
  const list=document.getElementById('card-list');
  list.innerHTML='';
  cardInventory.forEach((cardType,i)=>{
    const cd=CARD_DEFS[cardType];
    if(!cd)return;
    const el=document.createElement('div');
    el.className='card-option';
    el.innerHTML=`<span style="font-size:20px">${cd.icon}</span><div><b>${cd.name}</b><br><span style="font-size:11px;color:#a78bfa">${cd.desc}</span></div>`;
    el.addEventListener('click',()=>{
      // Find item and slot card
      let item=null;
      for(let sl in equipped){if(equipped[sl]&&equipped[sl].id===itemId)item=equipped[sl];}
      if(!item)item=backpack.find(b=>b.id===itemId);
      if(item){
        item.cardSlot=cardType;
        cardInventory.splice(i,1);
        updatePlayerFromGear();
        showPickup('Card slotted! '+cd.name,'#a855f7');
        sfx('pickup');
      }
      modal.style.display='none';
      renderInventory();
    });
    list.appendChild(el);
  });
  modal.style.display='block';
}
document.getElementById('card-modal-close').addEventListener('click',()=>{document.getElementById('card-slot-modal').style.display='none';});

function addLongPress(el,cb){
  let timer;
  const start=()=>{timer=setTimeout(()=>{haptic('medium');cb();},600);};
  const cancel=()=>clearTimeout(timer);
  el.addEventListener('touchstart',start);
  el.addEventListener('touchend',cancel);
  el.addEventListener('touchcancel',cancel);
  el.addEventListener('mousedown',start);
  el.addEventListener('mouseup',cancel);
  el.addEventListener('mouseleave',cancel);
}

function equipFromBackpack(idx){
  const item=backpack[idx];
  if(!item)return;
  const slot=item.slot;
  const old=equipped[slot];
  equipped[slot]=item;
  backpack.splice(idx,1);
  if(old)backpack.push(old);
  updatePlayerFromGear();
}

function unequipItem(slot){
  const item=equipped[slot];
  if(!item)return;
  if(backpack.length>=12){showPickup('Backpack full!','#ef4444');return;}
  backpack.push(item);
  equipped[slot]=null;
  updatePlayerFromGear();
}

function updatePlayerFromGear(){
  if(player){
    player.maxHp=totalMaxHp();
    if(player.hp>player.maxHp)player.hp=player.maxHp;
    player.speed=totalSpeed();
  }
}

function addToInventory(gear){
  if(backpack.length<16){
    backpack.push(gear);
    return true;
  }
  showPickup('Backpack full!','#ef4444');
  return false;
}
function addCard(cardType){
  cardInventory.push(cardType);
  return true;
}

// ─── ENEMIES ───
const ENEMY_DEFS={
  slime:{r:12,hp:40,maxHp:40,speed:40,dmg:8,color:'#22c55e',eyeColor:'#fff',atkRange:28,atkCd:1.5,xp:10},
  skeleton:{r:13,hp:60,maxHp:60,speed:55,dmg:12,color:'#e2e8f0',eyeColor:'#1a1a2e',atkRange:32,atkCd:1.2,xp:20},
  archer:{r:12,hp:35,maxHp:35,speed:30,dmg:10,color:'#a78bfa',eyeColor:'#fff',atkRange:180,atkCd:2.0,xp:25,ranged:true},
  charger:{r:14,hp:40,maxHp:40,speed:50,dmg:20,color:'#ea580c',eyeColor:'#fff',atkRange:30,atkCd:3.0,xp:30,
    chargeState:'idle',chargeTelegraph:0,chargeDir:{x:0,y:0},chargeSpeed:0,stunTimer:0},
  wolf:{r:10,hp:20,maxHp:20,speed:65,dmg:8,color:'#9ca3af',eyeColor:'#fbbf24',atkRange:24,atkCd:1.2,xp:8,
    packId:null,packAngle:0},
  bomber:{r:11,hp:25,maxHp:25,speed:30,dmg:30,color:'#f97316',eyeColor:'#fff',atkRange:60,atkCd:99,xp:20,
    fuseTimer:-1,fuseMax:2.0},
  necromancer:{r:14,hp:60,maxHp:60,speed:35,dmg:5,color:'#7e22ce',eyeColor:'#a855f7',atkRange:40,atkCd:2.0,xp:50,
    summonTimer:5,summonCount:0,teleportCd:0,summonIds:[]},
  shield_knight:{r:15,hp:70,maxHp:70,speed:40,dmg:12,color:'#6b7280',eyeColor:'#fff',atkRange:34,atkCd:2.5,xp:35,
    shieldAngle:0,bashCd:0,bashTimer:4.0},
  boss:{r:28,hp:300,maxHp:300,speed:45,dmg:18,color:'#ef4444',eyeColor:'#fbbf24',atkRange:40,atkCd:1.0,xp:100},
};

let nextPackId=0;
function spawnEnemies(){
  enemies=[];
  const def=dungeonRooms[currentRoom];
  const hpMult=1+(dungeonDepth-1)*0.3;
  const dmgMult=1+(dungeonDepth-1)*0.15;
  def.enemies.forEach(e=>{
    if(e.type==='pack'){
      // Wolf pack spawn
      const packId=nextPackId++;
      const count=e.count||3;
      for(let i=0;i<count;i++){
        const base=ENEMY_DEFS.wolf;
        const angle=(Math.PI*2/count)*i;
        const ox=Math.cos(angle)*20, oy=Math.sin(angle)*20;
        enemies.push({...base,type:'wolf',
          x:e.x*TILE+TILE/2+ox, y:e.y*TILE+TILE/2+oy,
          hp:Math.ceil(base.hp*hpMult),maxHp:Math.ceil(base.maxHp*hpMult),
          dmg:Math.ceil(base.dmg*dmgMult),
          atkTimer:Math.random()*base.atkCd,hit:0,knockX:0,knockY:0,
          packId,packAngle:(Math.PI*2/count)*i});
      }
      return;
    }
    const base=ENEMY_DEFS[e.type];
    if(!base)return;
    const en={...base,type:e.type,
      x:e.x*TILE+TILE/2,y:e.y*TILE+TILE/2,
      hp:Math.ceil(base.hp*hpMult),maxHp:Math.ceil(base.maxHp*hpMult),
      dmg:Math.ceil(base.dmg*dmgMult),
      atkTimer:Math.random()*base.atkCd,hit:0,knockX:0,knockY:0};
    // Type-specific init
    if(e.type==='charger'){en.chargeState='idle';en.chargeTelegraph=0;en.chargeDir={x:0,y:0};en.chargeSpeed=0;en.stunTimer=0;}
    if(e.type==='bomber'){en.fuseTimer=-1;en.fuseMax=2.0;}
    if(e.type==='necromancer'){en.summonTimer=5;en.summonCount=0;en.teleportCd=0;en.summonIds=[];}
    if(e.type==='shield_knight'){en.shieldAngle=0;en.bashCd=0;en.bashTimer=4.0;}
    enemies.push(en);
  });
}

// ─── JOYSTICK ───
function setupTouch(){
  const zone=document.getElementById('joystick-zone');
  zone.addEventListener('touchstart',e=>{e.preventDefault();if(joystickActive)return;const t=e.changedTouches[0];joystickTouchId=t.identifier;joystickActive=true;updateJoy(t);});
  zone.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches)if(t.identifier===joystickTouchId)updateJoy(t);});
  const endJoy=e=>{for(const t of e.changedTouches)if(t.identifier===joystickTouchId){joystickActive=false;joystickTouchId=null;joyVec={x:0,y:0};resetThumb();}};
  zone.addEventListener('touchend',endJoy);
  zone.addEventListener('touchcancel',endJoy);
  // Mouse/pointer support for desktop
  zone.addEventListener('mousedown',e=>{e.preventDefault();if(joystickActive)return;joystickActive=true;updateJoy(e);});
  window.addEventListener('mousemove',e=>{if(joystickActive)updateJoy(e);});
  window.addEventListener('mouseup',()=>{if(joystickActive){joystickActive=false;joyVec={x:0,y:0};resetThumb();}});
}

function updateJoy(t){
  const base=document.getElementById('joystick-base');
  const rect=base.getBoundingClientRect();
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  let dx=t.clientX-cx,dy=t.clientY-cy;
  const dist=Math.sqrt(dx*dx+dy*dy);
  const maxR=rect.width/2;
  if(dist>maxR){dx=dx/dist*maxR;dy=dy/dist*maxR;}
  joyVec={x:dx/maxR,y:dy/maxR};
  const thumb=document.getElementById('joystick-thumb');
  thumb.style.left=(rect.width/2-25+dx)+'px';
  thumb.style.bottom=(rect.height/2-25-dy)+'px';
}
function resetThumb(){
  const base=document.getElementById('joystick-base');
  const thumb=document.getElementById('joystick-thumb');
  thumb.style.left=(base.offsetWidth/2-25)+'px';
  thumb.style.bottom=(base.offsetHeight/2-25)+'px';
}

// ─── KEYBOARD (WASD) ───
const keysPressed: Set<string> = new Set();

function setupKeyboard() {
  window.addEventListener('keydown', e => {
    // Don't capture keys if chat input is focused
    if (chatInputOpen) return;

    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      keysPressed.add(key);
      e.preventDefault();
    }
    // Space for attack, Shift for dash, Q/E for class abilities
    if (key === ' ' || key === 'spacebar') { doAttack(); e.preventDefault(); }
    if (key === 'shift') { doDash(); e.preventDefault(); }
    if (key === 'q') { doAbility1(); e.preventDefault(); }
    if (key === 'e') { doAbility2(); e.preventDefault(); }
    // Enter to open chat (desktop)
    if (key === 'enter' && gameStarted && !gameOver && !gameDead && !emoteWheelOpen) {
      openChatInput();
      e.preventDefault();
    }
    // Escape to close emote wheel or chat
    if (key === 'escape') {
      if (emoteWheelOpen) closeEmoteWheel();
    }
  });
  window.addEventListener('keyup', e => {
    keysPressed.delete(e.key.toLowerCase());
  });
  // Clear keys on blur to prevent stuck keys
  window.addEventListener('blur', () => keysPressed.clear());
}

function updateKeyboardInput() {
  // Only update joyVec from keyboard if joystick isn't active
  if (joystickActive) return;

  let kx = 0, ky = 0;
  if (keysPressed.has('w') || keysPressed.has('arrowup')) ky -= 1;
  if (keysPressed.has('s') || keysPressed.has('arrowdown')) ky += 1;
  if (keysPressed.has('a') || keysPressed.has('arrowleft')) kx -= 1;
  if (keysPressed.has('d') || keysPressed.has('arrowright')) kx += 1;

  // Normalize diagonal movement
  if (kx !== 0 && ky !== 0) {
    const len = Math.sqrt(kx * kx + ky * ky);
    kx /= len;
    ky /= len;
  }

  joyVec = { x: kx, y: ky };
}

// ─── ABILITIES ───
function doAttack(){
  if(abilities.attack.cd>0||gameOver||gameDead||!gameStarted)return;
  abilities.attack.cd=ATTACK_CD;
  player.attackAnim=0.25;
  sfx('attack');haptic('light');
  const fx=player.facing.x,fy=player.facing.y;
  let dmg=totalAtk();
  const atkRange=getAttackRange();
  const gs1=getGearStats();
  const critChance=(gs1.crit||0)+(hasPassive('odinsEye')?15:0);
  const isCrit=Math.random()*100<critChance;
  // Ragnarok Blade — 10% chance 3x
  const ragnarok=hasPassive('ragnarokBlade')&&Math.random()<0.1;
  if(ragnarok){dmg*=3;}
  else if(isCrit){dmg=Math.ceil(dmg*1.5);}
  // Gungnir Tip — first hit on each enemy 2x
  
  // Attack server enemies - server handles damage calculation
  const serverEnemies = getServerEnemiesForRender();
  serverEnemies.forEach(e => {
    if (!e.isAlive) return;
    const dx = e.x - player.x, dy = e.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < atkRange + e.r) {
      // Visual feedback locally
      if (isCrit || ragnarok) {
        dmgNumbers.push({ x: e.x, y: e.y - e.r - 15, val: ragnarok ? 'RAGNAROK!' : 'CRIT!', life: 0.8, vy: -40, color: ragnarok ? '#f97316' : '#fbbf24' });
      }
      // Send attack to server
      const idx = serverEnemyIds.indexOf(e.serverId);
      if (idx >= 0) {
        callbacks.onAttack?.(idx);
      }
    }
  });
  // Slash particles scale with level
  const slashSize=20+playerLevel*1.5;
  for(let i=0;i<8;i++){
    const a=Math.atan2(fy,fx)+((Math.random()-0.5)*1.2);
    const sp=100+Math.random()*80;
    particles.push({x:player.x+fx*slashSize,y:player.y+fy*slashSize,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.3,maxLife:0.3,r:3+Math.random()*2+playerLevel*0.2,color:'#fbbf24'});
  }
}

function doDash(){
  if(abilities.dash.cd>0||gameOver||gameDead||!gameStarted)return;
  if(joyVec.x===0&&joyVec.y===0){player.dashDir={...player.facing};}
  else{const m=Math.sqrt(joyVec.x*joyVec.x+joyVec.y*joyVec.y);player.dashDir={x:joyVec.x/m,y:joyVec.y/m};}
  // DPS has faster dash cooldown (1.5s vs 3s)
  let dashCd = playerClass === 'dps' ? 1.5 : DASH_CD;
  abilities.dash.cd=hasPassive('lokiTrinket')?dashCd*0.5:dashCd;
  player.dashing=true;
  sfx('dash');haptic('light');
  callbacks.onDash?.(player.dashDir.x,player.dashDir.y);
  player.dashTimer=DASH_DUR;
  player.invincible=DASH_DUR+0.1;
  for(let i=0;i<6;i++){particles.push({x:player.x,y:player.y,vx:(Math.random()-0.5)*60,vy:(Math.random()-0.5)*60,life:0.4,maxLife:0.4,r:4,color:'#60a5fa'});}
}

// Class ability 1: Tank=Taunt, Healer=Healing Zone, DPS=none
function doAbility1(){
  if(abilities.ability1.cd>0||gameOver||gameDead||!gameStarted)return;
  if(playerClass==='tank'){
    // Taunt: find nearest enemy and taunt it
    let nearest=null,minD=Infinity;
    enemies.forEach((e,i)=>{if(e.hp>0){const d=Math.hypot(e.x-player.x,e.y-player.y);if(d<minD){minD=d;nearest={e,i};}}});
    if(nearest&&minD<200){
      abilities.ability1.cd=8;
      sfx('taunt');haptic('medium');
      callbacks.onTaunt?.(nearest.i);
      // Visual: blue pulse on enemy
      for(let i=0;i<8;i++){particles.push({x:nearest.e.x,y:nearest.e.y,vx:Math.cos(i*Math.PI/4)*40,vy:Math.sin(i*Math.PI/4)*40,life:0.5,maxLife:0.5,r:6,color:'#3b82f6'});}
      dmgNumbers.push({x:nearest.e.x,y:nearest.e.y-nearest.e.r-10,val:'TAUNT',life:1,vy:-40,color:'#3b82f6'});
    }
  }else if(playerClass==='healer'){
    // Healing Zone: place at player position
    abilities.ability1.cd=15;
    sfx('heal');haptic('medium');
    callbacks.onPlaceHealingZone?.(player.x,player.y);
    // Visual: green expanding ring
    for(let i=0;i<12;i++){particles.push({x:player.x,y:player.y,vx:Math.cos(i*Math.PI/6)*80,vy:Math.sin(i*Math.PI/6)*80,life:0.8,maxLife:0.8,r:8,color:'#22c55e'});}
  }
}

// Class ability 2: Tank=Knockback, Healer=none, DPS=none
function doAbility2(){
  if(abilities.ability2.cd>0||gameOver||gameDead||!gameStarted)return;
  if(playerClass==='tank'){
    // Knockback: push all enemies in 60px radius
    abilities.ability2.cd=12;
    sfx('knockback');haptic('heavy');
    callbacks.onKnockback?.();
    let hitCount=0;
    enemies.forEach(e=>{
      if(e.hp>0){
        const d=Math.hypot(e.x-player.x,e.y-player.y);
        if(d<80){
          hitCount++;
          const nx=(e.x-player.x)/d,ny=(e.y-player.y)/d;
          e.knockX=nx*150;e.knockY=ny*150;
          for(let i=0;i<4;i++){particles.push({x:e.x,y:e.y,vx:nx*60+(Math.random()-0.5)*40,vy:ny*60+(Math.random()-0.5)*40,life:0.4,maxLife:0.4,r:4,color:'#60a5fa'});}
        }
      }
    });
    // Shockwave visual
    for(let i=0;i<16;i++){particles.push({x:player.x,y:player.y,vx:Math.cos(i*Math.PI/8)*100,vy:Math.sin(i*Math.PI/8)*100,life:0.5,maxLife:0.5,r:5,color:'#3b82f6'});}
    if(hitCount>0)dmgNumbers.push({x:player.x,y:player.y-30,val:'KNOCKBACK',life:1,vy:-40,color:'#60a5fa'});
  }
}

function hitEnemy(e,dmg,nx,ny){
  // Shield knight frontal block check
  if(e.type==='shield_knight'){
    const hitAngle=Math.atan2(ny,nx);
    const shieldAngle=Math.atan2(player.y-e.y,player.x-e.x);
    let angleDiff=Math.abs(hitAngle-shieldAngle);
    if(angleDiff>Math.PI)angleDiff=Math.PI*2-angleDiff;
    if(angleDiff<Math.PI/2){
      // Frontal hit — 75% damage reduction
      dmg=Math.ceil(dmg*0.25);
      sfx('shield_block');
      for(let i=0;i<4;i++){particles.push({x:e.x+nx*e.r,y:e.y+ny*e.r,vx:(Math.random()-0.5)*60,vy:(Math.random()-0.5)*60,life:0.3,maxLife:0.3,r:2,color:'#60a5fa'});}
    }
  }
  e.hp-=dmg;
  e.hit=0.15;
  sfx('hit');haptic('medium');
  e.knockX=nx*80;e.knockY=ny*80;
  shakeTimer=0.1;shakeIntensity=3;
  dmgNumbers.push({x:e.x,y:e.y-e.r,val:dmg,life:0.8,vy:-60,color:'#fbbf24'});
  for(let i=0;i<5;i++){particles.push({x:e.x,y:e.y,vx:nx*60+(Math.random()-0.5)*80,vy:ny*60+(Math.random()-0.5)*80,life:0.35,maxLife:0.35,r:2+Math.random()*3,color:e.color});}
  // Legendary passive: Surtr's Ember — burn on hit
  if(hasPassive('surtrEmber')&&e.hp>0){
    if(!e.burning){e.burning=3;e.burnDmg=5;}
  }
  // Legendary passive: Fenrir's Fang — slow on hit
  if(hasPassive('fenrirFang')&&e.hp>0){
    e.slowTimer=2;
  }
  // Lifesteal
  const gs2=getGearStats();
  if(gs2.lifesteal>0&&e.hp>0){
    const heal=Math.ceil(dmg*gs2.lifesteal/100);
    player.hp=Math.min(player.maxHp,player.hp+heal);
  }
  // Reflect damage is handled in hitPlayer
  
  if(e.hp<=0){
    sfx('kill');haptic('kill');
    lifetimeKills++;
    // Unique death particles per enemy type
    const deathColor=e.type==='charger'?'#ea580c':e.type==='wolf'?'#6b7280':e.type==='bomber'?'#f97316':e.type==='necromancer'?'#a855f7':e.type==='shield_knight'?'#3b82f6':e.color;
    const deathCount=e.type==='necromancer'?18:e.type==='charger'?15:12;
    for(let i=0;i<deathCount;i++){const a=Math.random()*Math.PI*2;const sp=40+Math.random()*80;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.6,maxLife:0.6,r:3+Math.random()*4,color:deathColor});}
    // Necromancer death: kill all summons
    if(e.type==='necromancer'){
      enemies.forEach(o=>{
        if(o._summonedBy===e&&o.hp>0){
          o.hp=0;
          for(let i=0;i<6;i++){const a=Math.random()*Math.PI*2;particles.push({x:o.x,y:o.y,vx:Math.cos(a)*50,vy:Math.sin(a)*50,life:0.4,maxLife:0.4,r:3,color:'#a855f7'});}
          gainXP(o.xp);
        }
      });
    }
    gainXP(e.xp);
    spawnLoot(e.x,e.y,e.type);
    
    // Legendary passives on kill
    // Ragnarok Blade — 3x damage (handled in dmg calc above via crit)
    // Bomber's Last Gift — 15% chance to explode
    if(hasPassive('bombersGift')&&Math.random()<0.15){
      sfx('explosion');haptic('medium');
      enemies.forEach(o=>{
        if(o===e||o.hp<=0)return;
        const od=Math.sqrt((o.x-e.x)**2+(o.y-e.y)**2);
        if(od<70){
          const ndx=(o.x-e.x)/(od||1),ndy=(o.y-e.y)/(od||1);
          hitEnemy(o,Math.ceil(dmg*0.5),ndx,ndy);
        }
      });
      for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*80,vy:Math.sin(a)*80,life:0.5,maxLife:0.5,r:4,color:'#f97316'});}
    }
    // Hel's Embrace — 3% max HP on kill
    if(hasPassive('helsEmbrace')){
      const heal=Math.ceil(player.maxHp*0.03);
      player.hp=Math.min(player.maxHp,player.hp+heal);
    }
    // Mjolnir Shard — chain lightning
    if(hasPassive('mjolnirShard')){
      let chainCount=0;
      enemies.forEach(o=>{
        if(o===e||o.hp<=0||chainCount>=2)return;
        const od=Math.sqrt((o.x-e.x)**2+(o.y-e.y)**2);
        if(od<100){
          const ndx=(o.x-e.x)/(od||1),ndy=(o.y-e.y)/(od||1);
          hitEnemy(o,Math.ceil(dmg*0.3),ndx,ndy);
          chainCount++;
          // Lightning visual
          particles.push({x:e.x,y:e.y,vx:(o.x-e.x)*2,vy:(o.y-e.y)*2,life:0.2,maxLife:0.2,r:2,color:'#60a5fa'});
        }
      });
    }
  }
}

function hitPlayer(dmg,attackerType){
  if(player.invincible>0)return;
  const def=totalDef();
  let actualDmg=Math.max(1,dmg-def);
  
  // Valkyrie Aegis — 20% chance negate
  if(hasPassive('valkyrieAegis')&&Math.random()<0.2){
    dmgNumbers.push({x:player.x,y:player.y-player.r,val:'BLOCKED',life:0.8,vy:-60,color:'#60a5fa'});
    sfx('shield_block');haptic('light');
    return;
  }
  // Slime King's Crown — slimes deal 50% less
  if(hasPassive('slimeKingCrown')&&attackerType==='slime'){
    actualDmg=Math.ceil(actualDmg*0.5);
  }
  
  player.hp-=actualDmg;
  player.invincible=0.5;
  sfx('hurt');haptic('heavy');
  shakeTimer=0.15;shakeIntensity=5;
  dmgNumbers.push({x:player.x,y:player.y-player.r,val:actualDmg,life:0.8,vy:-60,color:'#ef4444'});
  
  // Reflect damage
  const gs3=getGearStats();
  if(gs3.reflect>0){
    // Find nearest enemy and reflect
    let nearest=null,minDist=Infinity;
    enemies.forEach(e=>{if(e.hp>0){const d=Math.sqrt((e.x-player.x)**2+(e.y-player.y)**2);if(d<minDist){minDist=d;nearest=e;}}});
    if(nearest&&minDist<80){
      const rdmg=gs3.reflect;
      nearest.hp-=rdmg;
      dmgNumbers.push({x:nearest.x,y:nearest.y-nearest.r,val:rdmg,life:0.6,vy:-40,color:'#a855f7'});
    }
  }
  for(let i=0;i<4;i++){particles.push({x:player.x,y:player.y,vx:(Math.random()-0.5)*100,vy:(Math.random()-0.5)*100,life:0.3,maxLife:0.3,r:3,color:'#ef4444'});}
  if(player.hp<=0){
    // Yggdrasil Leaf auto-revive
    if(hasPassive('yggdrasilLeaf')&&!yggdrasilUsed){
      yggdrasilUsed=true;
      player.hp=player.maxHp;
      player.invincible=2;
      showPickup('🍃 Yggdrasil Leaf — REVIVED!','#22c55e');
      sfx('levelup');haptic('win');
      for(let i=0;i<20;i++){const a=Math.random()*Math.PI*2;particles.push({x:player.x,y:player.y,vx:Math.cos(a)*80,vy:Math.sin(a)*80,life:0.8,maxLife:0.8,r:4,color:'#22c55e'});}
      return;
    }
    player.hp=0;gameDead=true;sfx('die');haptic('die');setTimeout(()=>{document.getElementById('death-screen').style.display='flex';},500);
  }
}

// ─── COLLISION ───
function tileAt(tx,ty){
  const room=rooms[currentRoom];
  if(tx<0||ty<0||tx>=ROOM_W||ty>=ROOM_H)return 1;
  return room[ty][tx];
}
function canMove(x,y,r){
  const margin=r;
  const corners=[[x-margin,y-margin],[x+margin,y-margin],[x-margin,y+margin],[x+margin,y+margin]];
  for(const[cx,cy]of corners){
    const tx=Math.floor(cx/TILE),ty=Math.floor(cy/TILE);
    if(tileAt(tx,ty)===1)return false;
  }
  return true;
}

// ─── ROOM TRANSITION ───
function checkDoor(){
  const def=dungeonRooms[currentRoom];
  // Check server enemies - all enemies come from server
  const hasLivingEnemies = Array.from(serverEnemyStates.values()).some(e => e.isAlive);
  if(hasLivingEnemies)return;
  if(def.doors.includes('bottom')&&player.y>=(ROOM_H-2.5)*TILE){
    const doorX=7*TILE+TILE/2;
    if(Math.abs(player.x-doorX)<TILE*2) goToRoom(currentRoom+1,'top');
  }
  if(def.doors.includes('top')&&player.y<=TILE*2.5){
    const doorX=7*TILE+TILE/2;
    if(Math.abs(player.x-doorX)<TILE*2) goToRoom(currentRoom-1,'bottom');
  }
}

function goToRoom(idx,enterFrom){
  if(idx<0||idx>=dungeonRooms.length)return;
  roomTransition=0.4;roomTransAlpha=0;
  sfx('door');
  setTimeout(()=>{
    currentRoom=idx;
    lootDrops=[];
    serverLootMap.clear(); // Clear stale loot from previous room
    serverEnemyStates.clear(); // Clear - server will send new enemies for this room
    serverEnemyIds = [];
    // Enemies come from server via callbacks.onEnterRoom -> enterRoom reducer
    // Spawn outside door trigger zones (top: y<=2.5*TILE, bottom: y>=(ROOM_H-2.5)*TILE)
    if(enterFrom==='top')player.y=3.5*TILE;
    else player.y=(ROOM_H-3.5)*TILE;
    player.x=7*TILE+TILE/2;
    showRoomLabel(dungeonRooms[idx].name);
    callbacks.onEnterRoom?.(idx);
  },200);
}

function showRoomLabel(name){
  const el=document.getElementById('room-label');
  el.textContent=name;el.style.opacity='1';
  setTimeout(()=>{el.style.opacity='0';},2000);
}

// ─── PROJECTILES ───
let projectiles=[];

// ─── UPDATE ───
function update(dt){
  if(!gameStarted||gameOver||gameDead)return;

  // Update keyboard input (WASD)
  updateKeyboardInput();

  // Slow-mo effect
  if(slowMoTimer>0){
    slowMoTimer-=dt;
    dt*=0.3; // 30% speed during level up
  }
  
  if(abilities.attack.cd>0)abilities.attack.cd=Math.max(0,abilities.attack.cd-dt);
  if(abilities.dash.cd>0)abilities.dash.cd=Math.max(0,abilities.dash.cd-dt);
  if(abilities.ability1.cd>0)abilities.ability1.cd=Math.max(0,abilities.ability1.cd-dt);
  if(abilities.ability2.cd>0)abilities.ability2.cd=Math.max(0,abilities.ability2.cd-dt);
  if(player.invincible>0)player.invincible-=dt;
  if(player.attackAnim>0)player.attackAnim-=dt;
  if(shakeTimer>0)shakeTimer-=dt;
  if(roomTransition>0){roomTransition-=dt;roomTransAlpha=roomTransition>0.2?1:roomTransition/0.2;}

  // Sparkle effect for full gear
  if(hasFullGear()){
    sparkleTimer+=dt;
    if(sparkleTimer>0.15){
      sparkleTimer=0;
      const a=Math.random()*Math.PI*2;
      const dist=getPlayerRadius()+4+Math.random()*8;
      sparkleParticles.push({
        x:player.x+Math.cos(a)*dist,
        y:player.y+Math.sin(a)*dist,
        life:0.6,maxLife:0.6,r:1+Math.random()*1.5
      });
    }
  }
  sparkleParticles.forEach(s=>{s.life-=dt;s.y-=15*dt;});
  sparkleParticles=sparkleParticles.filter(s=>s.life>0);
  
  // Freya's Blessing — regen 1% max HP/sec
  if(hasPassive('freyaBlessing')){
    player.hp=Math.min(player.maxHp,player.hp+player.maxHp*0.01*dt);
  }

  // player movement
  player.speed=totalSpeed();
  if(player.dashing){
    player.dashTimer-=dt;
    const dashDist=getDashDist();
    const sp=dashDist/DASH_DUR;
    const nx=player.x+player.dashDir.x*sp*dt;
    const ny=player.y+player.dashDir.y*sp*dt;
    if(canMove(nx,ny,player.r)){player.x=nx;player.y=ny;}
    if(player.dashTimer<=0)player.dashing=false;
  }else{
    const mag=Math.sqrt(joyVec.x*joyVec.x+joyVec.y*joyVec.y);
    if(mag>0.1){
      const nx=player.x+joyVec.x*player.speed*dt;
      const ny=player.y+joyVec.y*player.speed*dt;
      if(canMove(nx,player.y,player.r))player.x=nx;
      if(canMove(player.x,ny,player.r))player.y=ny;
      player.facing={x:joyVec.x/mag,y:joyVec.y/mag};
    }
  }

  // Throttled position sync (~15Hz)
  const now=performance.now();
  if(now-lastPositionSendTime>66){
    lastPositionSendTime=now;
    callbacks.onPlayerMove?.(player.x,player.y,player.facing.x,player.facing.y);
  }

  // Interpolate other players toward their server positions
  lerpOtherPlayers(dt);

  // Server-authoritative enemy interpolation
  updateServerEnemyInterpolation();

  // Update/expire player messages
  updateMessages();

  // Local enemies array kept for legacy compatibility but not used for AI
  enemies.forEach(e=>{
    if(e.hp<=0)return;
    if(e.hit>0){e.hit-=dt;e.x+=e.knockX*dt*4;e.y+=e.knockY*dt*4;e.knockX*=0.9;e.knockY*=0.9;if(!canMove(e.x,e.y,e.r)){e.x-=e.knockX*dt*4;e.y-=e.knockY*dt*4;}return;}
    // Burning (Surtr's Ember)
    if(e.burning>0){
      e.burning-=dt;
      e.burnAccum=(e.burnAccum||0)+dt;
      if(e.burnAccum>=0.5){e.burnAccum=0;e.hp-=e.burnDmg;dmgNumbers.push({x:e.x,y:e.y-e.r-5,val:e.burnDmg,life:0.5,vy:-30,color:'#f97316'});
        if(e.hp<=0){sfx('kill');haptic('kill');lifetimeKills++;gainXP(e.xp);spawnLoot(e.x,e.y,e.type);for(let i=0;i<8;i++){const a=Math.random()*Math.PI*2;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*50,vy:Math.sin(a)*50,life:0.4,maxLife:0.4,r:3,color:'#f97316'});}}}
    }
    // Slow (Fenrir's Fang)
    const speedMod=(e.slowTimer&&e.slowTimer>0)?(e.slowTimer-=dt,0.5):1;
    const dx=player.x-e.x,dy=player.y-e.y;
    const dist=Math.sqrt(dx*dx+dy*dy);

    // ─── CHARGER AI ───
    if(e.type==='charger'){
      if(e.stunTimer>0){e.stunTimer-=dt;return;}
      if(e.chargeState==='idle'){
        // Wander slowly toward player
        if(dist>60){
          const nx=e.x+dx/dist*e.speed*0.5*dt;
          const ny=e.y+dy/dist*e.speed*0.5*dt;
          if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
        }
        e.atkTimer-=dt;
        if(e.atkTimer<=0&&dist<200){
          e.chargeState='telegraph';e.chargeTelegraph=0.8;
          e.chargeDir={x:dx/dist,y:dy/dist};
          e.atkTimer=e.atkCd;
        }
      }else if(e.chargeState==='telegraph'){
        e.chargeTelegraph-=dt;
        if(e.chargeTelegraph<=0){e.chargeState='charging';e.chargeSpeed=e.speed*3;e.chargeTimer=1.5;}
      }else if(e.chargeState==='charging'){
        e.chargeTimer-=dt;
        const nx=e.x+e.chargeDir.x*e.chargeSpeed*dt;
        const ny=e.y+e.chargeDir.y*e.chargeSpeed*dt;
        if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
        else{
          // Hit wall → stunned
          e.chargeState='idle';e.stunTimer=1.5;
          sfx('charge_impact');haptic('heavy');shakeTimer=0.2;shakeIntensity=6;
          for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*80,vy:Math.sin(a)*80,life:0.5,maxLife:0.5,r:3,color:'#fbbf24'});}
        }
        // Hit player while charging
        if(dist<e.r+player.r+5){hitPlayer(e.dmg,e.type);e.chargeState='idle';e.atkTimer=e.atkCd;}
        if(e.chargeTimer<=0)e.chargeState='idle';
      }
    }
    // ─── WOLF AI ───
    else if(e.type==='wolf'){
      // Count alive pack members
      const packMates=enemies.filter(o=>o.hp>0&&o.type==='wolf'&&o.packId===e.packId);
      const packSize=packMates.length;
      const myIdx=packMates.indexOf(e);
      // Target angle around player
      const targetAngle=(Math.PI*2/packSize)*myIdx+Date.now()*0.001;
      const orbDist=50;
      const tx=player.x+Math.cos(targetAngle)*orbDist;
      const ty=player.y+Math.sin(targetAngle)*orbDist;
      const tdx=tx-e.x,tdy=ty-e.y;
      const tdist=Math.sqrt(tdx*tdx+tdy*tdy);
      if(tdist>5){
        const nx=e.x+tdx/tdist*e.speed*dt;
        const ny=e.y+tdy/tdist*e.speed*dt;
        if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
      }
      // Pack bonus: attack faster when 2+ wolves close
      const closeWolves=packMates.filter(w=>{ const d=Math.sqrt((player.x-w.x)**2+(player.y-w.y)**2);return d<50;}).length;
      const atkCdMod=closeWolves>=2?0.6:1.0;
      e.atkTimer-=dt;
      if(e.atkTimer<=0&&dist<e.atkRange+player.r){
        e.atkTimer=e.atkCd*atkCdMod;
        hitPlayer(e.dmg,e.type);
      }
    }
    // ─── BOMBER AI ───
    else if(e.type==='bomber'){
      if(e.fuseTimer<0){
        // Walk toward player slowly
        if(dist>e.atkRange){
          const nx=e.x+dx/dist*e.speed*dt;
          const ny=e.y+dy/dist*e.speed*dt;
          if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
        }else{
          // Start countdown
          e.fuseTimer=e.fuseMax;
        }
      }else{
        e.fuseTimer-=dt;
        if(e.fuseTimer<=0){
          // EXPLODE
          sfx('explosion');haptic('heavy');shakeTimer=0.3;shakeIntensity=8;
          const expR=80;
          // Damage player
          if(dist<expR+player.r)hitPlayer(e.dmg,e.type);
          // Damage other enemies
          enemies.forEach(o=>{
            if(o===e||o.hp<=0)return;
            const od=Math.sqrt((o.x-e.x)**2+(o.y-e.y)**2);
            if(od<expR+o.r){
              const ndx=(o.x-e.x)/(od||1), ndy=(o.y-e.y)/(od||1);
              hitEnemy(o,e.dmg,ndx,ndy);
            }
          });
          // Explosion particles
          for(let i=0;i<20;i++){const a=Math.random()*Math.PI*2;const sp=60+Math.random()*120;
            particles.push({x:e.x,y:e.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.6,maxLife:0.6,r:4+Math.random()*5,color:['#f97316','#ef4444','#fbbf24'][Math.floor(Math.random()*3)]});}
          e.hp=0; // Die
          gainXP(e.xp);spawnLoot(e.x,e.y,e.type);
        }
      }
    }
    // ─── NECROMANCER AI ───
    else if(e.type==='necromancer'){
      // Flee if player too close
      if(e.teleportCd>0)e.teleportCd-=dt;
      if(dist<80&&e.teleportCd<=0){
        // Teleport away
        let nx,ny,attempts=0;
        do{nx=2*TILE+Math.random()*11*TILE;ny=3*TILE+Math.random()*14*TILE;attempts++;}
        while((!canMove(nx,ny,e.r)||Math.sqrt((player.x-nx)**2+(player.y-ny)**2)<120)&&attempts<20);
        e.x=nx;e.y=ny;e.teleportCd=3;
        for(let i=0;i<8;i++){particles.push({x:e.x,y:e.y,vx:(Math.random()-0.5)*80,vy:(Math.random()-0.5)*80,life:0.5,maxLife:0.5,r:3,color:'#a855f7'});}
      }else if(dist<150){
        // Move away
        const nx=e.x-dx/dist*e.speed*dt;const ny=e.y-dy/dist*e.speed*dt;
        if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
      }
      // Summon skeletons
      e.summonTimer-=dt;
      // Clean dead summons
      e.summonIds=e.summonIds.filter(id=>enemies.some(o=>o._summonId===id&&o.hp>0));
      if(e.summonTimer<=0&&e.summonIds.length<3){
        e.summonTimer=5;
        sfx('summon');
        const count=1+Math.floor(Math.random()*2);
        for(let i=0;i<count&&e.summonIds.length<3;i++){
          const base=ENEMY_DEFS.skeleton;
          const sa=Math.random()*Math.PI*2;
          const sid=Math.random().toString(36).substr(2,6);
          const summon={...base,type:'skeleton',
            x:e.x+Math.cos(sa)*30,y:e.y+Math.sin(sa)*30,
            hp:Math.ceil(base.hp*0.5),maxHp:Math.ceil(base.maxHp*0.5),
            dmg:base.dmg,atkTimer:Math.random()*base.atkCd,hit:0,knockX:0,knockY:0,
            _summonId:sid,_summonedBy:e};
          enemies.push(summon);
          e.summonIds.push(sid);
          // Purple summon particles
          for(let j=0;j<8;j++){particles.push({x:summon.x,y:summon.y,vx:(Math.random()-0.5)*60,vy:(Math.random()-0.5)*60,life:0.5,maxLife:0.5,r:3,color:'#a855f7'});}
        }
      }
      // Weak direct attack
      e.atkTimer-=dt;
      if(e.atkTimer<=0&&dist<e.atkRange+player.r){e.atkTimer=e.atkCd;hitPlayer(e.dmg,e.type);}
    }
    // ─── SHIELD KNIGHT AI ───
    else if(e.type==='shield_knight'){
      e.shieldAngle=Math.atan2(dy,dx);
      // Move toward player
      if(dist>e.atkRange){
        const nx=e.x+dx/dist*e.speed*dt;const ny=e.y+dy/dist*e.speed*dt;
        if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
      }
      // Regular attack
      e.atkTimer-=dt;
      if(e.atkTimer<=0&&dist<e.atkRange+player.r){e.atkTimer=e.atkCd;hitPlayer(e.dmg,e.type);}
      // Shield bash
      e.bashTimer-=dt;
      if(e.bashTimer<=0&&dist<e.atkRange+player.r+10){
        e.bashTimer=4.0;
        sfx('shield_block');haptic('medium');
        // Knockback player
        const kx=dx/dist*100,ky=dy/dist*100;
        const pnx=player.x+kx*0.3,pny=player.y+ky*0.3;
        if(canMove(pnx,pny,player.r)){player.x=pnx;player.y=pny;}
        hitPlayer(Math.ceil(e.dmg*0.5),e.type);
        for(let i=0;i<6;i++){particles.push({x:e.x+dx/dist*e.r,y:e.y+dy/dist*e.r,vx:dx/dist*40+(Math.random()-0.5)*40,vy:dy/dist*40+(Math.random()-0.5)*40,life:0.3,maxLife:0.3,r:3,color:'#60a5fa'});}
      }
    }
    // ─── RANGED (archer) ───
    else if(e.ranged){
      if(dist<120){const nx=e.x-dx/dist*e.speed*dt;const ny=e.y-dy/dist*e.speed*dt;if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}}
      e.atkTimer-=dt;
      if(e.atkTimer<=0&&dist<e.atkRange){
        e.atkTimer=e.atkCd;
        projectiles.push({x:e.x,y:e.y,vx:dx/dist*200,vy:dy/dist*200,r:4,dmg:e.dmg,life:2,color:'#c084fc'});
      }
    }
    // ─── DEFAULT MELEE (slime, skeleton, boss) ───
    else{
      if(dist>e.atkRange){
        const nx=e.x+dx/dist*e.speed*speedMod*dt;
        const ny=e.y+dy/dist*e.speed*speedMod*dt;
        if(canMove(nx,ny,e.r)){e.x=nx;e.y=ny;}
      }
      e.atkTimer-=dt;
      if(e.atkTimer<=0&&dist<e.atkRange+player.r){
        e.atkTimer=e.atkCd;
        hitPlayer(e.dmg,e.type);
      }
    }

    if(e.type==='boss'&&e.hp<e.maxHp*0.5&&Math.random()<0.01){
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        projectiles.push({x:e.x,y:e.y,vx:Math.cos(a)*120,vy:Math.sin(a)*120,r:5,dmg:10,life:2.5,color:'#f97316'});
      }
    }
  });

  // projectiles
  projectiles.forEach(p=>{
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;
    const dx=p.x-player.x,dy=p.y-player.y;
    if(Math.sqrt(dx*dx+dy*dy)<player.r+p.r){hitPlayer(p.dmg,'ranged');p.life=0;}
    const tx=Math.floor(p.x/TILE),ty=Math.floor(p.y/TILE);
    if(tileAt(tx,ty)===1)p.life=0;
  });
  projectiles=projectiles.filter(p=>p.life>0);

  // loot physics & pickup
  lootDrops.forEach(l=>{
    l.glow+=dt;
    // Bouncing physics
    if(l.bouncing){
      l.vy=(l.vy||0)+300*dt; // gravity
      l.x+=(l.vx||0)*dt;
      l.y+=l.vy*dt;
      if(l.y>=l.groundY){
        l.y=l.groundY;
        l.vy*=-0.4; // bounce dampen
        l.vx*=0.7;
        if(Math.abs(l.vy)<15){l.bouncing=false;l.vy=0;l.vx=0;}
      }
    }
    const dx=player.x-l.x,dy=player.y-l.y;
    const pickDist=l.bouncing?player.r+8:player.r+18; // smaller pickup while bouncing
    if(Math.sqrt(dx*dx+dy*dy)<pickDist&&!l.bouncing){
      if(l.type==='gold'){
        gold+=l.amount;
        lifetimeGold+=l.amount;
        showPickup('+ '+l.amount+' Gold','#fbbf24');
        sfx('pickup');
      }else if(l.type==='gear'){
        if(addToInventory(l.gear)){
          const rarityLabel=l.gear.rarity==='legendary'?'⭐ LEGENDARY: ':'';
          showPickup(rarityLabel+l.gear.name,l.gear.rarityColor);
          sfx(l.gear.rarity==='legendary'?'win':'pickup');
        }
      }else if(l.type==='card'){
        addCard(l.cardType);
        const cd=CARD_DEFS[l.cardType];
        showPickup('🃏 '+cd.name+' dropped!','#a855f7');
        sfx('win');haptic('heavy');
      }
      l.picked=true;
      const lootJson=l.type==='gear'?JSON.stringify(l.gear):l.type==='card'?JSON.stringify({cardType:l.cardType}):JSON.stringify({type:'gold',amount:l.amount});
      const lootRarity=l.type==='gear'?(l.gear.rarity||'common'):l.type==='card'?'rare':'common';
      callbacks.onPickupLoot?.(lootDrops.indexOf(l),lootJson,lootRarity);
    }
  });
  lootDrops=lootDrops.filter(l=>!l.picked);

  // particles
  particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;p.vx*=0.95;p.vy*=0.95;});
  particles=particles.filter(p=>p.life>0);
  dmgNumbers.forEach(d=>{d.y+=d.vy*dt;d.life-=dt;});
  dmgNumbers=dmgNumbers.filter(d=>d.life>0);

  // camera - room size equals viewport, so camera stays at origin
  camera.x = 0;
  camera.y = 0;

  checkDoor();

  // boss dead → dungeon complete
  const allEnemiesDead = !Array.from(serverEnemyStates.values()).some(e => e.isAlive);
  if(dungeonRooms[currentRoom].isBoss&&allEnemiesDead&&!gameOver){
    gameOver=true;sfx('win');haptic('win');
    lifetimeDungeons++;
    dungeonDepth++;
    callbacks.onCompleteDungeon?.();
    document.getElementById('complete-text').textContent='Run '+(dungeonDepth-1)+' cleared!';
    setTimeout(()=>{document.getElementById('screen-overlay').style.display='flex';},1000);
  }

  // UI updates
  player.maxHp=totalMaxHp();
  const fill=document.getElementById('health-bar-fill');
  fill.style.width=(player.hp/player.maxHp*100)+'%';
  fill.style.background=player.hp>player.maxHp*0.5?'linear-gradient(180deg,#4ade80,#22c55e)':player.hp>player.maxHp*0.25?'linear-gradient(180deg,#fbbf24,#f59e0b)':'linear-gradient(180deg,#ef4444,#dc2626)';
  document.getElementById('health-text').textContent=Math.ceil(player.hp)+' / '+player.maxHp;
  document.getElementById('level-label').textContent='Lv '+playerLevel;
  document.getElementById('xp-bar-fill').style.width=(playerXP/xpToLevel(playerLevel)*100)+'%';
  document.getElementById('gold-display').textContent='💰 '+gold;

  updateAbilityUI('btn-attack',abilities.attack);
  updateAbilityUI('btn-dash',abilities.dash);
  updateAbilityUI('btn-ability1',abilities.ability1);
  updateAbilityUI('btn-ability2',abilities.ability2);
}

function updateAbilityUI(id,ab){
  const btn=document.getElementById(id);
  if(!btn)return;
  const overlay=btn.querySelector('.cd-overlay') as HTMLElement;
  const text=btn.querySelector('.cd-text') as HTMLElement;
  if(ab.cd>0){
    const pct=ab.cd/ab.maxCd;
    const deg=pct*360;
    overlay.style.clipPath=`polygon(50% 50%, 50% 0%, ${deg>90?'100% 0%,':''}${deg>180?'100% 100%,':''}${deg>270?'0% 100%,':''}${cdEdge(deg)})`;
    overlay.style.display='block';
    text.textContent=ab.cd.toFixed(1);
    btn.style.opacity='0.7';
  }else{
    overlay.style.display='none';
    text.textContent='';
    btn.style.opacity='1';
  }
}
function cdEdge(deg){
  if(deg<=90)return(50+50*Math.tan(deg*Math.PI/180))+'% 0%';
  if(deg<=180)return'100% '+(50+50*Math.tan((deg-90)*Math.PI/180))+'%';
  if(deg<=270)return(50-50*Math.tan((deg-180)*Math.PI/180))+'% 100%';
  return'0% '+(50-50*Math.tan((deg-270)*Math.PI/180))+'%';
}

// ─── DRAW ───
function draw(){
  const dpr=window.devicePixelRatio||1;

  // Clear full canvas with black (letterbox color)
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,W,H);

  // Apply game transform (scale + center offset)
  ctx.setTransform(dpr*gameScale,0,0,dpr*gameScale,dpr*gameOffsetX,dpr*gameOffsetY);

  // Fill game area background
  ctx.fillStyle='#1a1a2e';
  ctx.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);
  if(!gameStarted)return;

  ctx.save();
  let sx=0,sy=0;
  if(shakeTimer>0){sx=(Math.random()-0.5)*shakeIntensity*2;sy=(Math.random()-0.5)*shakeIntensity*2;}
  ctx.translate(-camera.x+sx,-camera.y+sy);

  // tiles
  const room=rooms[currentRoom];
  for(let y=0;y<ROOM_H;y++)for(let x=0;x<ROOM_W;x++){
    const t=room[y][x];
    const px=x*TILE,py=y*TILE;
    if(t===1){
      ctx.fillStyle='#1a1a2e';ctx.fillRect(px,py,TILE,TILE);
      ctx.fillStyle='#252540';ctx.fillRect(px+1,py+1,TILE-2,TILE-2);
    }else if(t===2){
      const cleared = !Array.from(serverEnemyStates.values()).some(e => e.isAlive);
      ctx.fillStyle=cleared?'#065f46':'#7f1d1d';
      ctx.fillRect(px,py,TILE,TILE);
      if(cleared){ctx.fillStyle='#10b981';ctx.fillRect(px+8,py+2,TILE-16,TILE-4);}
    }else{
      ctx.fillStyle=(x+y)%2===0?'#2d3a4a':'#263242';
      ctx.fillRect(px,py,TILE,TILE);
      ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.strokeRect(px,py,TILE,TILE);
    }
  }

  // loot drops with rarity visuals
  lootDrops.forEach(l=>{
    ctx.save();
    ctx.translate(l.x,l.y);
    const pulse=0.8+Math.sin(l.glow*4)*0.2;
    
    if(l.type==='gold'){
      ctx.globalAlpha=0.3+Math.sin(l.glow*3)*0.15;
      ctx.fillStyle='#fbbf24';
      ctx.beginPath();ctx.arc(0,0,10*pulse,0,Math.PI*2);ctx.fill();
    }else if(l.type==='card'){
      // Purple glow for cards
      ctx.globalAlpha=0.4+Math.sin(l.glow*3)*0.2;
      ctx.fillStyle='#a855f7';
      ctx.beginPath();ctx.arc(0,0,16*pulse,0,Math.PI*2);ctx.fill();
      // Rotating sparkles
      for(let i=0;i<4;i++){
        const a=l.glow*2+i*Math.PI/2;
        ctx.fillStyle='#c084fc';
        ctx.beginPath();ctx.arc(Math.cos(a)*12,Math.sin(a)*12,2,0,Math.PI*2);ctx.fill();
      }
    }else if(l.type==='gear'){
      const r=l.gear.rarity;
      const color=l.gear.rarityColor;
      if(r==='common'){
        ctx.globalAlpha=0.2+Math.sin(l.glow*3)*0.1;
        ctx.fillStyle='#fff';
        ctx.beginPath();ctx.arc(0,0,12*pulse,0,Math.PI*2);ctx.fill();
      }else if(r==='uncommon'){
        ctx.globalAlpha=0.3+Math.sin(l.glow*3)*0.15;
        ctx.fillStyle=color;
        ctx.beginPath();ctx.arc(0,0,14*pulse,0,Math.PI*2);ctx.fill();
      }else if(r==='rare'){
        ctx.globalAlpha=0.35+Math.sin(l.glow*3)*0.2;
        ctx.fillStyle=color;
        ctx.beginPath();ctx.arc(0,0,16*pulse,0,Math.PI*2);ctx.fill();
        // Sparkle particles
        for(let i=0;i<3;i++){
          const a=l.glow*3+i*2.1;
          const sx=Math.cos(a)*14,sy=Math.sin(a)*14;
          ctx.globalAlpha=0.6+Math.sin(l.glow*5+i)*0.3;
          ctx.fillStyle='#93c5fd';
          ctx.beginPath();ctx.arc(sx,sy,1.5,0,Math.PI*2);ctx.fill();
        }
      }else if(r==='epic'){
        // Purple glow + rotating particles + light beam
        ctx.globalAlpha=0.15;
        ctx.fillStyle=color;
        ctx.fillRect(-2,-60,4,60); // light beam
        ctx.globalAlpha=0.4+Math.sin(l.glow*3)*0.2;
        ctx.beginPath();ctx.arc(0,0,18*pulse,0,Math.PI*2);ctx.fill();
        for(let i=0;i<5;i++){
          const a=l.glow*2+i*Math.PI*2/5;
          ctx.globalAlpha=0.7;
          ctx.fillStyle='#c084fc';
          ctx.beginPath();ctx.arc(Math.cos(a)*16,Math.sin(a)*16,2,0,Math.PI*2);ctx.fill();
        }
      }else if(r==='legendary'){
        // ORANGE glow + light PILLAR + particles
        ctx.globalAlpha=0.25+Math.sin(l.glow*2)*0.1;
        ctx.fillStyle='#f97316';
        ctx.fillRect(-3,-120,6,120); // tall light pillar
        ctx.globalAlpha=0.5+Math.sin(l.glow*3)*0.25;
        const grad=ctx.createRadialGradient(0,0,5,0,0,24*pulse);
        grad.addColorStop(0,'#fbbf24');
        grad.addColorStop(0.5,'#f97316');
        grad.addColorStop(1,'rgba(249,115,22,0)');
        ctx.fillStyle=grad;
        ctx.beginPath();ctx.arc(0,0,24*pulse,0,Math.PI*2);ctx.fill();
        // Rotating + rising particles
        for(let i=0;i<8;i++){
          const a=l.glow*1.5+i*Math.PI/4;
          const r2=18+Math.sin(l.glow*3+i)*5;
          ctx.globalAlpha=0.8;
          ctx.fillStyle=['#fbbf24','#f97316','#fff'][i%3];
          ctx.beginPath();ctx.arc(Math.cos(a)*r2,Math.sin(a)*r2-Math.sin(l.glow*4+i)*8,2.5,0,Math.PI*2);ctx.fill();
        }
      }
    }
    
    ctx.globalAlpha=1;
    ctx.font=l.type==='gear'&&(l.gear.rarity==='epic'||l.gear.rarity==='legendary')?'20px system-ui':'16px system-ui';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(l.icon,0,0);
    ctx.restore();
  });

  // enemies
  enemies.forEach(e=>{
    if(e.hp<=0)return;
    ctx.save();
    ctx.translate(e.x,e.y);
    if(e.hit>0)ctx.globalAlpha=0.5+Math.sin(e.hit*40)*0.5;

    if(e.type==='boss'){
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.arc(0,0,e.r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#991b1b';ctx.beginPath();ctx.arc(0,0,e.r-4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(0,0,e.r-8,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fbbf24';
      ctx.fillRect(-12,-e.r-8,24,8);
      ctx.beginPath();ctx.moveTo(-12,-e.r-8);ctx.lineTo(-8,-e.r-16);ctx.lineTo(-4,-e.r-8);ctx.fill();
      ctx.beginPath();ctx.moveTo(-4,-e.r-8);ctx.lineTo(0,-e.r-16);ctx.lineTo(4,-e.r-8);ctx.fill();
      ctx.beginPath();ctx.moveTo(4,-e.r-8);ctx.lineTo(8,-e.r-16);ctx.lineTo(12,-e.r-8);ctx.fill();
    }else if(e.type==='slime'){
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.ellipse(0,2,e.r,e.r*0.8,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#16a34a';
      ctx.beginPath();ctx.ellipse(0,4,e.r*0.7,e.r*0.5,0,0,Math.PI*2);ctx.fill();
    }else if(e.type==='skeleton'){
      ctx.fillStyle=e.color;
      ctx.fillRect(-e.r,-e.r,e.r*2,e.r*2);
      ctx.fillStyle='#94a3b8';
      ctx.fillRect(-e.r+2,-e.r+2,e.r*2-4,e.r*2-4);
    }else if(e.type==='archer'){
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.moveTo(0,-e.r);ctx.lineTo(e.r,e.r);ctx.lineTo(-e.r,e.r);ctx.closePath();ctx.fill();
    }else if(e.type==='charger'){
      // Red-orange rectangle wider than tall with horns
      const shake=(e.chargeState==='telegraph')?(Math.random()-0.5)*4:0;
      ctx.translate(shake,0);
      if(e.chargeState==='telegraph'){
        // Red glow telegraph
        ctx.fillStyle='rgba(239,68,68,'+((0.3+Math.sin(Date.now()*0.02)*0.3))+')';
        ctx.beginPath();ctx.arc(0,0,e.r+8,0,Math.PI*2);ctx.fill();
      }
      ctx.fillStyle=e.chargeState==='charging'?'#dc2626':e.color;
      ctx.fillRect(-e.r-4,-e.r+2,e.r*2+8,e.r*2-4);
      // Horns
      ctx.fillStyle='#fbbf24';
      ctx.beginPath();ctx.moveTo(-e.r+2,-e.r+2);ctx.lineTo(-e.r,-e.r-8);ctx.lineTo(-e.r+6,-e.r+2);ctx.fill();
      ctx.beginPath();ctx.moveTo(e.r-6,-e.r+2);ctx.lineTo(e.r,-e.r-8);ctx.lineTo(e.r-2,-e.r+2);ctx.fill();
      // Stunned stars
      if(e.stunTimer>0){
        for(let i=0;i<3;i++){
          const sa=Date.now()*0.005+i*2.1;
          const sx=Math.cos(sa)*12,sy=-e.r-12+Math.sin(sa*2)*3;
          ctx.fillStyle='#fbbf24';ctx.font='10px system-ui';ctx.textAlign='center';
          ctx.fillText('⭐',sx,sy);
        }
      }
    }else if(e.type==='wolf'){
      // Small gray circle
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.arc(0,0,e.r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#6b7280';
      ctx.beginPath();ctx.arc(0,1,e.r-2,0,Math.PI*2);ctx.fill();
      // Pointy ears
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.moveTo(-6,-e.r+1);ctx.lineTo(-4,-e.r-5);ctx.lineTo(-2,-e.r+1);ctx.fill();
      ctx.beginPath();ctx.moveTo(2,-e.r+1);ctx.lineTo(4,-e.r-5);ctx.lineTo(6,-e.r+1);ctx.fill();
    }else if(e.type==='bomber'){
      // Orange circle with fuse; pulse during countdown
      let scale=1;
      if(e.fuseTimer>=0){
        const frac=1-e.fuseTimer/e.fuseMax;
        scale=1+frac*0.3;
        const pulseSpeed=5+frac*20;
        ctx.fillStyle=Math.sin(Date.now()*0.001*pulseSpeed)>0?'#ef4444':e.color;
      }else{
        ctx.fillStyle=e.color;
      }
      ctx.beginPath();ctx.arc(0,0,e.r*scale,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#c2410c';
      ctx.beginPath();ctx.arc(0,1,e.r*scale-3,0,Math.PI*2);ctx.fill();
      // Fuse on top
      ctx.strokeStyle='#854d0e';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,-e.r*scale);ctx.lineTo(2,-e.r*scale-6);ctx.stroke();
      // Fuse spark
      ctx.fillStyle=['#fbbf24','#ef4444','#fff'][Math.floor(Math.random()*3)];
      ctx.beginPath();ctx.arc(2+Math.random()*2,-e.r*scale-6+Math.random()*2,2,0,Math.PI*2);ctx.fill();
    }else if(e.type==='necromancer'){
      // Dark purple diamond with hood
      ctx.fillStyle=e.color;
      ctx.beginPath();ctx.moveTo(0,-e.r);ctx.lineTo(e.r,0);ctx.lineTo(0,e.r);ctx.lineTo(-e.r,0);ctx.closePath();ctx.fill();
      // Hood (triangle on top)
      ctx.fillStyle='#581c87';
      ctx.beginPath();ctx.moveTo(-8,-e.r+4);ctx.lineTo(0,-e.r-8);ctx.lineTo(8,-e.r+4);ctx.closePath();ctx.fill();
      // Summoning glow
      if(e.summonTimer<1){
        ctx.globalAlpha=0.4+Math.sin(Date.now()*0.01)*0.2;
        ctx.fillStyle='#a855f7';
        ctx.beginPath();ctx.arc(0,0,e.r+10,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=1;
      }
    }else if(e.type==='shield_knight'){
      // Gray square body
      ctx.fillStyle=e.color;
      ctx.fillRect(-e.r,-e.r,e.r*2,e.r*2);
      ctx.fillStyle='#4b5563';
      ctx.fillRect(-e.r+2,-e.r+2,e.r*2-4,e.r*2-4);
      // Shield (blue square facing player)
      const sa=e.shieldAngle||0;
      ctx.save();
      ctx.rotate(sa);
      ctx.fillStyle='#3b82f6';
      ctx.fillRect(e.r-4,-8,6,16);
      ctx.fillStyle='#60a5fa';
      ctx.fillRect(e.r-3,-6,4,12);
      ctx.restore();
    }

    // Eyes (shared for all types)
    const edx=player.x-e.x,edy=player.y-e.y,da=Math.atan2(edy,edx);
    ctx.fillStyle=e.eyeColor;
    const eex=Math.cos(da)*3,eey=Math.sin(da)*3;
    ctx.beginPath();ctx.arc(-4+eex,-3+eey,2.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(4+eex,-3+eey,2.5,0,Math.PI*2);ctx.fill();
    // HP bar (always show with Odin's Eye)
    if(e.hp<e.maxHp||hasPassive('odinsEye')){
      ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(-e.r,-e.r-8,e.r*2,5);
      ctx.fillStyle='#ef4444';ctx.fillRect(-e.r,-e.r-8,e.r*2*(e.hp/e.maxHp),5);
    }
    // Burning indicator
    if(e.burning>0){
      ctx.globalAlpha=0.5+Math.sin(Date.now()*0.01)*0.3;
      ctx.fillStyle='#f97316';
      ctx.beginPath();ctx.arc(0,0,e.r+3,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }
    // Slow indicator
    if(e.slowTimer>0){
      ctx.strokeStyle='#60a5fa';ctx.lineWidth=2;ctx.globalAlpha=0.5;
      ctx.beginPath();ctx.arc(0,0,e.r+4,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;
    }
    ctx.restore();
  });

  // Server enemies - render with interpolated positions (already scaled to client coords)
  getServerEnemiesForRender().forEach(e => {
      if (!e.isAlive) return;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.hit > 0) ctx.globalAlpha = 0.5 + Math.sin(e.hit * 40) * 0.5;

      const visuals = getEnemyVisuals(e.enemyType);
      const r = visuals.r;
      const color = visuals.color;
      const eyeColor = visuals.eyeColor;

      // Draw based on enemy type
      if (e.enemyType === 'boss') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#991b1b'; ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r - 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-12, -r - 8, 24, 8);
      } else if (e.enemyType === 'slime') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(0, 2, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#16a34a';
        ctx.beginPath(); ctx.ellipse(0, 4, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      } else if (e.enemyType === 'skeleton') {
        ctx.fillStyle = color;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-r + 2, -r + 2, r * 2 - 4, r * 2 - 4);
      } else if (e.enemyType === 'archer') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill();
      } else if (e.enemyType === 'charger') {
        const shake = (e.aiState === 'telegraph') ? (Math.random() - 0.5) * 4 : 0;
        ctx.translate(shake, 0);
        if (e.aiState === 'telegraph') {
          ctx.fillStyle = 'rgba(239,68,68,' + (0.3 + Math.sin(Date.now() * 0.02) * 0.3) + ')';
          ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = e.aiState === 'charge' ? '#dc2626' : color;
        ctx.fillRect(-r - 4, -r + 2, r * 2 + 8, r * 2 - 4);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.moveTo(-r + 2, -r + 2); ctx.lineTo(-r, -r - 8); ctx.lineTo(-r + 6, -r + 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r - 6, -r + 2); ctx.lineTo(r, -r - 8); ctx.lineTo(r - 2, -r + 2); ctx.fill();
        if (e.aiState === 'stunned') {
          for (let i = 0; i < 3; i++) {
            const sa = Date.now() * 0.005 + i * 2.1;
            const sx = Math.cos(sa) * 12, sy = -r - 12 + Math.sin(sa * 2) * 3;
            ctx.fillStyle = '#fbbf24'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
            ctx.fillText('⭐', sx, sy);
          }
        }
      } else if (e.enemyType === 'wolf') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b7280';
        ctx.beginPath(); ctx.arc(0, 1, r - 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(-6, -r + 1); ctx.lineTo(-4, -r - 5); ctx.lineTo(-2, -r + 1); ctx.fill();
        ctx.beginPath(); ctx.moveTo(2, -r + 1); ctx.lineTo(4, -r - 5); ctx.lineTo(6, -r + 1); ctx.fill();
      } else if (e.enemyType === 'bomber') {
        let scale = 1;
        if (e.aiState === 'fuse') {
          const frac = 1 - e.stateTimer / 1.5;
          scale = 1 + frac * 0.3;
          const pulseSpeed = 5 + frac * 20;
          ctx.fillStyle = Math.sin(Date.now() * 0.001 * pulseSpeed) > 0 ? '#ef4444' : color;
        } else {
          ctx.fillStyle = color;
        }
        ctx.beginPath(); ctx.arc(0, 0, r * scale, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c2410c';
        ctx.beginPath(); ctx.arc(0, 1, r * scale - 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#854d0e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -r * scale); ctx.lineTo(2, -r * scale - 6); ctx.stroke();
        ctx.fillStyle = ['#fbbf24', '#ef4444', '#fff'][Math.floor(Math.random() * 3)];
        ctx.beginPath(); ctx.arc(2 + Math.random() * 2, -r * scale - 6 + Math.random() * 2, 2, 0, Math.PI * 2); ctx.fill();
      } else if (e.enemyType === 'necromancer') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#581c87';
        ctx.beginPath(); ctx.moveTo(-8, -r + 4); ctx.lineTo(0, -r - 8); ctx.lineTo(8, -r + 4); ctx.closePath(); ctx.fill();
        if (e.aiState === 'summon') {
          ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.01) * 0.2;
          ctx.fillStyle = '#a855f7';
          ctx.beginPath(); ctx.arc(0, 0, r + 10, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (e.enemyType === 'shield_knight') {
        ctx.fillStyle = color;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(-r + 2, -r + 2, r * 2 - 4, r * 2 - 4);
        const sa = e.facingAngle || 0;
        ctx.save();
        ctx.rotate(sa);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(r - 4, -8, 6, 16);
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(r - 3, -6, 4, 12);
        ctx.restore();
      } else if (e.enemyType === 'bat') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // Bat wings
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r - 6, -4); ctx.lineTo(-r - 4, 4); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r + 6, -4); ctx.lineTo(r + 4, 4); ctx.closePath(); ctx.fill();
      } else {
        // Default circle
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      }

      // Eyes (facing angle from server)
      const edx = Math.cos(e.facingAngle), edy = Math.sin(e.facingAngle);
      ctx.fillStyle = eyeColor;
      const eex = edx * 3, eey = edy * 3;
      ctx.beginPath(); ctx.arc(-4 + eex, -3 + eey, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4 + eex, -3 + eey, 2.5, 0, Math.PI * 2); ctx.fill();

      // HP bar
      if (e.hp < e.maxHp || hasPassive('odinsEye')) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-r, -r - 8, r * 2, 5);
        ctx.fillStyle = '#ef4444'; ctx.fillRect(-r, -r - 8, r * 2 * (e.hp / e.maxHp), 5);
      }

      ctx.restore();
    });

  // projectiles
  projectiles.forEach(p=>{
    ctx.fillStyle=p.color;ctx.globalAlpha=0.8;
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
  });

  // player
  ctx.save();
  ctx.translate(player.x,player.y);
  if(player.invincible>0)ctx.globalAlpha=0.4+Math.sin(player.invincible*30)*0.3;
  
  const colors=getPlayerColor();
  const pr=getPlayerRadius();
  const glowI=getGlowIntensity();
  
  // Glow ring (level-based)
  if(glowI>0.05){
    const gradient=ctx.createRadialGradient(0,0,pr,0,0,pr+8+glowI*12);
    gradient.addColorStop(0,`rgba(251,191,36,${glowI*0.4})`);
    gradient.addColorStop(1,'rgba(251,191,36,0)');
    ctx.fillStyle=gradient;
    ctx.beginPath();ctx.arc(0,0,pr+8+glowI*12,0,Math.PI*2);ctx.fill();
  }
  
  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.3)';ctx.beginPath();ctx.ellipse(0,pr-2,pr,pr*0.4,0,0,Math.PI*2);ctx.fill();
  
  // Body with level-based color
  ctx.fillStyle=colors.main;ctx.beginPath();ctx.arc(0,0,pr,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=colors.mid;ctx.beginPath();ctx.arc(0,2,pr-3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=colors.main;ctx.beginPath();ctx.arc(0,-1,pr-5,0,Math.PI*2);ctx.fill();
  
  // Eyes
  const fa=Math.atan2(player.facing.y,player.facing.x);
  const pex=Math.cos(fa)*4,pey=Math.sin(fa)*4;
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.arc(-4+pex,-2+pey,3.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(4+pex,-2+pey,3.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#1e293b';
  ctx.beginPath();ctx.arc(-4+pex*1.3,-2+pey*1.3,1.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(4+pex*1.3,-2+pey*1.3,1.5,0,Math.PI*2);ctx.fill();
  
  // Attack animation (scales with level)
  if(player.attackAnim>0){
    const atkRange=getAttackRange();
    const slashR=22+playerLevel*1.5;
    ctx.strokeStyle='rgba(251,191,36,0.6)';ctx.lineWidth=3+playerLevel*0.2;
    ctx.beginPath();ctx.arc(player.facing.x*(atkRange*0.4),player.facing.y*(atkRange*0.4),slashR,fa-1,fa+1);ctx.stroke();
  }
  
  ctx.restore();
  
  // Equipped weapon icons floating near player
  const gearIcons=[];
  if(equipped.weapon) gearIcons.push(equipped.weapon.icon);
  if(equipped.armor) gearIcons.push(equipped.armor.icon);
  if(equipped.accessory) gearIcons.push(equipped.accessory.icon);
  if(gearIcons.length>0){
    const now=Date.now()*0.002;
    gearIcons.forEach((icon,i)=>{
      const angle=now+i*(Math.PI*2/gearIcons.length);
      const gx=player.x+Math.cos(angle)*(pr+14);
      const gy=player.y+Math.sin(angle)*(pr+14);
      ctx.font='10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.globalAlpha=0.7;
      ctx.fillText(icon,gx,gy);
      ctx.globalAlpha=1;
    });
  }
  
  // Other players (co-op)
  otherPlayers.forEach((op, id) => {
    const opColor = getPlayerColorForLevel(op.level, op.playerClass);
    const opRadius = getPlayerRadiusForLevel(op.level);
    ctx.save();
    ctx.translate(op.x, op.y);
    // Shadow
    ctx.fillStyle='rgba(0,0,0,0.3)';ctx.beginPath();ctx.ellipse(0,opRadius-2,opRadius,opRadius*0.4,0,0,Math.PI*2);ctx.fill();
    // Body (colored by class)
    ctx.fillStyle=opColor.main;ctx.beginPath();ctx.arc(0,0,opRadius,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=opColor.mid;ctx.beginPath();ctx.arc(0,2,opRadius-3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=opColor.main;ctx.beginPath();ctx.arc(0,-1,opRadius-5,0,Math.PI*2);ctx.fill();
    // Eyes
    const ofa=Math.atan2(op.facingY,op.facingX);
    const opex=Math.cos(ofa)*4,opey=Math.sin(ofa)*4;
    ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(-4+opex,-2+opey,3.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(4+opex,-2+opey,3.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#1e293b';
    ctx.beginPath();ctx.arc(-4+opex*1.3,-2+opey*1.3,1.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(4+opex*1.3,-2+opey*1.3,1.5,0,Math.PI*2);ctx.fill();
    // Equipment icons orbiting around player
    const opGear = [op.weaponIcon, op.armorIcon, op.accessoryIcon].filter(i => i);
    opGear.forEach((icon, i) => {
      const angle = -Math.PI/2 + i*(Math.PI*2/3) + performance.now()*0.001;
      const gx = Math.cos(angle)*(opRadius+14);
      const gy = Math.sin(angle)*(opRadius+14);
      ctx.font='12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(icon, gx, gy);
    });
    // Name label with level
    ctx.fillStyle=opColor.light;ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(`${op.name} Lv${op.level}`, 0, -opRadius-4);
    ctx.restore();

    // Speech bubble for this player
    const opMsg = activeMessages.get(id);
    if (opMsg) {
      drawSpeechBubble(op.x, op.y, opMsg.content, opMsg.messageType === 'emote');
    }
  });

  // Speech bubble for local player
  if (player) {
    const myIdentity = (window as any).__spacetimeIdentity;
    if (myIdentity) {
      const myMsg = activeMessages.get(myIdentity);
      if (myMsg) {
        drawSpeechBubble(player.x, player.y, myMsg.content, myMsg.messageType === 'emote');
      }
    }
  }

  // Full gear sparkle particles
  sparkleParticles.forEach(s=>{
    ctx.globalAlpha=(s.life/s.maxLife)*0.8;
    ctx.fillStyle='#fbbf24';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;

  // particles
  particles.forEach(p=>{
    ctx.globalAlpha=p.life/p.maxLife;ctx.fillStyle=p.color;
    ctx.beginPath();ctx.arc(p.x,p.y,p.r*(p.life/p.maxLife),0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;

  // dmg numbers (and XP gains with + prefix)
  dmgNumbers.forEach(d=>{
    ctx.globalAlpha=d.life/0.8;
    ctx.fillStyle=d.color;ctx.font='bold 16px system-ui';ctx.textAlign='center';
    const prefix = (d as any).prefix || '-';
    ctx.fillText(prefix+d.val,d.x,d.y);
  });
  ctx.globalAlpha=1;

  ctx.restore();

  // room transition overlay
  if(roomTransition>0){
    ctx.fillStyle=`rgba(0,0,0,${roomTransAlpha})`;
    ctx.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);
  }

  drawMinimap();
}

function drawMinimap(){
  const mc=minimapCtx;
  mc.clearRect(0,0,80,80);
  mc.fillStyle='rgba(0,0,0,0.5)';
  mc.fillRect(0,0,80,80);
  const totalRooms=dungeonRooms.length;
  const roomH=12,roomW=16,gap=4;
  const startY=(80-(totalRooms*(roomH+gap)-gap))/2;
  for(let i=0;i<totalRooms;i++){
    const rx=(80-roomW)/2,ry=startY+i*(roomH+gap);
    mc.fillStyle=i===currentRoom?'#3b82f6':'#475569';
    if(i<currentRoom)mc.fillStyle='#22c55e';
    mc.fillRect(rx,ry,roomW,roomH);
    if(i===currentRoom){mc.fillStyle='#fbbf24';mc.fillRect(rx+6,ry+3,4,6);}
    if(dungeonRooms[i].isBoss){mc.fillStyle='#ef4444';mc.fillRect(rx+2,ry+2,3,3);}
  }
}

// ─── SPEECH BUBBLE DRAWING ───
function drawSpeechBubble(x: number, y: number, text: string, isEmote: boolean) {
  ctx.save();

  // Measure text
  ctx.font = isEmote ? 'bold 14px system-ui' : '12px system-ui';
  const metrics = ctx.measureText(text);
  const textWidth = Math.min(metrics.width, 120);
  const padding = 8;
  const bubbleWidth = textWidth + padding * 2;
  const bubbleHeight = isEmote ? 28 : 24;
  const tailHeight = 8;
  const cornerRadius = 8;

  // Position bubble above player
  const bubbleX = x - bubbleWidth / 2;
  const bubbleY = y - 50 - bubbleHeight - tailHeight;

  // Draw bubble background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.moveTo(bubbleX + cornerRadius, bubbleY);
  ctx.lineTo(bubbleX + bubbleWidth - cornerRadius, bubbleY);
  ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY, bubbleX + bubbleWidth, bubbleY + cornerRadius);
  ctx.lineTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight - cornerRadius);
  ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight, bubbleX + bubbleWidth - cornerRadius, bubbleY + bubbleHeight);
  ctx.lineTo(bubbleX + bubbleWidth / 2 + 6, bubbleY + bubbleHeight);
  // Tail
  ctx.lineTo(bubbleX + bubbleWidth / 2, bubbleY + bubbleHeight + tailHeight);
  ctx.lineTo(bubbleX + bubbleWidth / 2 - 6, bubbleY + bubbleHeight);
  ctx.lineTo(bubbleX + cornerRadius, bubbleY + bubbleHeight);
  ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleHeight, bubbleX, bubbleY + bubbleHeight - cornerRadius);
  ctx.lineTo(bubbleX, bubbleY + cornerRadius);
  ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + cornerRadius, bubbleY);
  ctx.closePath();
  ctx.fill();

  // Draw bubble border
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw text
  ctx.fillStyle = '#1a1a2e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, bubbleY + bubbleHeight / 2, 120);

  ctx.restore();
}

// Update and expire messages
function updateMessages() {
  const now = Date.now();
  activeMessages.forEach((msg, identity) => {
    if (now >= msg.expiresAt) {
      activeMessages.delete(identity);
    }
  });
}

// ─── LOOP ───
function loop(t){
  const dt=Math.min((t-lastTime)/1000,0.05);
  lastTime=t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// Original: window.addEventListener('load',init);
// Now exported as startGame()

// Export the init function
export function restoreFromServer(data: {
  gold?: number;
  level?: number;
  xp?: number;
  dungeonDepth?: number;
  playerClass?: string;
  inventory?: Array<{ itemDataJson: string; equippedSlot?: string | null; cardDataJson?: string | null }>;
}) {
  if (data.gold != null) gold = data.gold;
  if (data.level != null) playerLevel = data.level;
  if (data.xp != null) playerXP = data.xp;
  if (data.dungeonDepth != null) dungeonDepth = data.dungeonDepth;
  if (data.playerClass) {
    if (data.playerClass === 'tank' || data.playerClass === 'healer' || data.playerClass === 'dps') {
      playerClass = data.playerClass as PlayerClass;
      classSelected = true;
      setupClassAbilityButtons();
    }
  }
  if (data.inventory) {
    backpack = [];
    equipped = { weapon: null, armor: null, accessory: null };
    data.inventory.forEach(item => {
      try {
        const parsed = JSON.parse(item.itemDataJson);
        if (item.equippedSlot && (item.equippedSlot === 'weapon' || item.equippedSlot === 'armor' || item.equippedSlot === 'accessory')) {
          equipped[item.equippedSlot] = parsed;
        } else {
          backpack.push(parsed);
        }
      } catch (e) {
        console.warn('[Game] Failed to parse inventory item:', e);
      }
    });
  }
  console.log('[Game] State restored from server — gold:', gold, 'level:', playerLevel, 'depth:', dungeonDepth);
}

/** Sync player stats from server (HP, XP, level for server-authoritative updates) */
export function syncPlayerStats(hp: number, maxHp: number, xp?: number, level?: number) {
  console.log('[Game] syncPlayerStats called:', { hp, maxHp, xp, level, hasPlayer: !!player, gameStarted, gameDead });
  if (!player) return;

  // Sync XP and level if provided
  if (xp !== undefined && level !== undefined) {
    const prevXP = playerXP;
    const prevLevel = playerLevel;
    playerXP = xp;
    playerLevel = level;

    // Show level up feedback
    if (level > prevLevel) {
      showPickup('LEVEL UP! Lv ' + level, '#fbbf24');
      sfx('levelup');
      haptic('win');
      // Level up particles
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push({
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * 80,
          vy: Math.sin(a) * 80,
          life: 0.8,
          maxLife: 0.8,
          r: 4,
          color: '#fbbf24'
        });
      }
    }
    // Show XP gain feedback (if XP increased but not level)
    else if (xp > prevXP) {
      const gained = xp - prevXP;
      dmgNumbers.push({
        x: player.x,
        y: player.y - player.r - 20,
        val: gained,
        life: 1.0,
        vy: -40,
        color: '#22c55e',
        prefix: '+'
      });
    }
    // HUD is updated automatically in the game loop
  }

  const previousHp = player.hp;
  console.log('[Game] HP change:', { previousHp, newHp: hp, damageTaken: previousHp - hp });
  player.maxHp = maxHp;
  player.hp = hp;

  // Detect damage taken from server
  if (hp < previousHp && gameStarted && !gameDead) {
    const damageTaken = previousHp - hp;

    // Visual feedback
    sfx('hurt');
    haptic('heavy');
    shakeTimer = 0.15;
    shakeIntensity = 5;
    player.invincible = 0.3; // Brief invincibility flash

    // Damage number
    dmgNumbers.push({
      x: player.x,
      y: player.y - player.r,
      val: damageTaken,
      life: 0.8,
      vy: -60,
      color: '#ef4444'
    });

    // Damage particles
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: player.x,
        y: player.y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100,
        life: 0.3,
        maxLife: 0.3,
        r: 3,
        color: '#ef4444'
      });
    }

    // Death check
    if (hp <= 0 && !gameDead) {
      // Check for Yggdrasil Leaf auto-revive
      if (hasPassive('yggdrasilLeaf') && !yggdrasilUsed) {
        player.hp = Math.floor(player.maxHp * 0.3);
        yggdrasilUsed = true;
        showPickup('🍃 Yggdrasil Leaf — REVIVED!', '#22c55e');
        sfx('levelup');
        haptic('win');
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          particles.push({
            x: player.x,
            y: player.y,
            vx: Math.cos(a) * 80,
            vy: Math.sin(a) * 80,
            life: 0.8,
            maxLife: 0.8,
            r: 4,
            color: '#22c55e'
          });
        }
      } else {
        player.hp = 0;
        gameDead = true;
        sfx('die');
        haptic('die');
        setTimeout(() => {
          document.getElementById('death-screen').style.display = 'flex';
        }, 500);
      }
    }
  }
}

/** Get equipped item icons for syncing to server */
export function getEquippedIcons(): { weapon: string, armor: string, accessory: string } {
  return {
    weapon: (equipped.weapon as any)?.icon || '',
    armor: (equipped.armor as any)?.icon || '',
    accessory: (equipped.accessory as any)?.icon || '',
  };
}

// ─── EMOTE WHEEL & CHAT INPUT SETUP ───
function setupEmoteButton() {
  const btn = document.getElementById('btn-emote');
  const wheel = document.getElementById('emote-wheel');
  if (!btn || !wheel) return;

  // Long press to open wheel
  const startHold = (e: Event) => {
    e.preventDefault();
    emoteButtonHoldTimer = window.setTimeout(() => {
      openEmoteWheel();
    }, EMOTE_HOLD_THRESHOLD);
  };

  const endHold = (e: Event) => {
    e.preventDefault();
    if (emoteButtonHoldTimer !== null) {
      clearTimeout(emoteButtonHoldTimer);
      // Short tap - open chat input instead
      if (!emoteWheelOpen) {
        openChatInput();
      }
      emoteButtonHoldTimer = null;
    }
  };

  btn.addEventListener('touchstart', startHold);
  btn.addEventListener('touchend', endHold);
  btn.addEventListener('touchcancel', endHold);
  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('mouseup', endHold);
  btn.addEventListener('mouseleave', () => {
    if (emoteButtonHoldTimer !== null) {
      clearTimeout(emoteButtonHoldTimer);
      emoteButtonHoldTimer = null;
    }
  });

  // Emote wheel option clicks
  wheel.querySelectorAll('.emote-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      const emote = (opt as HTMLElement).dataset.emote;
      if (emote) {
        callbacks.onSendEmote?.(emote);
      }
      closeEmoteWheel();
    });
    opt.addEventListener('touchend', (e) => {
      e.preventDefault();
      const emote = (opt as HTMLElement).dataset.emote;
      if (emote) {
        callbacks.onSendEmote?.(emote);
      }
      closeEmoteWheel();
    });
  });

  // Close wheel when clicking outside
  wheel.addEventListener('click', (e) => {
    if (e.target === wheel) {
      closeEmoteWheel();
    }
  });
}

function openEmoteWheel() {
  const wheel = document.getElementById('emote-wheel');
  if (!wheel || !gameStarted || gameOver || gameDead) return;
  emoteWheelOpen = true;
  wheel.style.display = 'block';
}

function closeEmoteWheel() {
  const wheel = document.getElementById('emote-wheel');
  if (wheel) wheel.style.display = 'none';
  emoteWheelOpen = false;
}

function setupChatInput() {
  const overlay = document.getElementById('chat-input-overlay');
  const input = document.getElementById('chat-input') as HTMLInputElement;
  if (!overlay || !input) return;

  // Close on click outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeChatInput();
    }
  });

  // Send on Enter, close on Escape
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        callbacks.onSendChat?.(text);
      }
      closeChatInput();
    } else if (e.key === 'Escape') {
      closeChatInput();
    }
  });
}

function openChatInput() {
  const overlay = document.getElementById('chat-input-overlay');
  const input = document.getElementById('chat-input') as HTMLInputElement;
  if (!overlay || !input || !gameStarted || gameOver || gameDead) return;
  chatInputOpen = true;
  overlay.style.display = 'flex';
  input.value = '';
  input.focus();
}

function closeChatInput() {
  const overlay = document.getElementById('chat-input-overlay');
  const input = document.getElementById('chat-input') as HTMLInputElement;
  if (overlay) overlay.style.display = 'none';
  if (input) input.blur();
  chatInputOpen = false;
}

/** Receive a message from another player (called from main.ts) */
export function receiveMessage(
  senderIdentity: string,
  senderName: string,
  messageType: string,
  content: string
) {
  const now = Date.now();
  activeMessages.set(senderIdentity, {
    senderIdentity,
    senderName,
    messageType,
    content,
    createdAt: now,
    expiresAt: now + MESSAGE_DURATION,
  });
}

export function initGame() {
  exposeGlobals();
  init();
}

// ─── PLAYER CLASS EXPORTS ───
export function getPlayerClass(): PlayerClass {
  return playerClass;
}

export function setPlayerClass(pClass: PlayerClass) {
  playerClass = pClass;
  classSelected = true;
  setupClassAbilityButtons();
  console.log('[Game] Player class set to:', pClass);
}

function setupClassAbilityButtons() {
  const btn1 = document.getElementById('btn-ability1');
  const btn2 = document.getElementById('btn-ability2');
  if (!btn1 || !btn2) return;

  // Reset classes
  btn1.className = 'ability-btn';
  btn2.className = 'ability-btn';

  if (playerClass === 'tank') {
    btn1.style.display = 'flex';
    btn1.classList.add('tank');
    btn1.querySelector('span').textContent = '🎯'; // Taunt
    btn2.style.display = 'flex';
    btn2.classList.add('tank');
    btn2.querySelector('span').textContent = '💥'; // Knockback
    abilities.ability1.maxCd = 8;
    abilities.ability2.maxCd = 12;
  } else if (playerClass === 'healer') {
    btn1.style.display = 'flex';
    btn1.classList.add('healer');
    btn1.querySelector('span').textContent = '💚'; // Healing Zone
    btn2.style.display = 'none'; // Healer only has 1 active ability
    abilities.ability1.maxCd = 15;
  } else if (playerClass === 'dps') {
    // DPS has passive abilities (faster dash, backstab) - no active ability buttons
    btn1.style.display = 'none';
    btn2.style.display = 'none';
  } else {
    btn1.style.display = 'none';
    btn2.style.display = 'none';
  }
}

export function isClassSelected(): boolean {
  return classSelected;
}

// Called from main.ts when restoring from server
export function restorePlayerClass(pClass: string) {
  if (pClass === 'tank' || pClass === 'healer' || pClass === 'dps') {
    playerClass = pClass as PlayerClass;
    classSelected = true;
    setupClassAbilityButtons();
    console.log('[Game] Restored player class from server:', pClass);
  }
}

// Get class-specific color for player rendering
export function getClassColor(pClass: PlayerClass): { main: string; mid: string; light: string } {
  switch (pClass) {
    case 'tank':
      return { main: '#3b82f6', mid: '#2563eb', light: '#93c5fd' }; // blue
    case 'healer':
      return { main: '#22c55e', mid: '#16a34a', light: '#86efac' }; // green
    case 'dps':
      return { main: '#ef4444', mid: '#dc2626', light: '#fca5a5' }; // red
    default:
      return { main: '#3b82f6', mid: '#2563eb', light: '#93c5fd' };
  }
}
