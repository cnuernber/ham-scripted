goog.module("ham_fisted.BitmapTrie");
goog.module.declareLegacyNamespace();


function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (h1 >>> 0);
}

function sizeIfPossible(arg) {
    if(arg == null) return 0;
    if(arg.length) return arg.length;
    const sz = arg.size;
    if(sz != null) {
	if(typeof(sz) === "function") return arg.size();
	return sz;
    }
    return null;
}


function mixHash(hash) {
    return (hash >>> 0) ^ hash >>> 16;
}

function defaultHash(obj) {
    if (obj == null) return 0;
    if (typeof(obj) == "number")
	return mixHash(Math.floor(obj));
    return cyrb53(obj.toString());
}


function defaultEquals(lhs, rhs) {
    return lhs == rhs;
}


const defaultProvider = {hash: defaultHash,
			 equals: defaultEquals,
			 isReduced: (v) => false,
			 unreduce: (v) => v};

function mask(shift,hash) {
    return (hash >>> shift) & 0x01f;
}

function bitpos(shift, hashcode) {
    return 1 << mask(shift, hashcode);
}

function bitCount32 (n) {
  n = n - ((n >> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333)
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24
}

function bitIndex(bitmap, bit) {
    return bitCount32(bitmap & (bit - 1));
}

function nextPow2(n) {
    let rval = 1 << 31 - Math.clz32(n);
    return rval == n ? rval : rval << 1;
}


function incShift(s) { return s+5; }


function copyOf(srcData, len) {
    let nary = srcData.slice(0, len);
    if(nary.length < len) {
	nary.length = len
    }
    return nary;
}


function insert(srcData, obj, insertIdx, newLen, forceCopy) {
    let srcLen = srcData.length;
    let dstLen = nextPow2(newLen);
    let copy = forceCopy || dstLen > srcLen;
    let dstData = copy ? copyOf(srcData, dstLen) : srcData;
    for(let ridx = newLen-1; ridx > insertIdx; --ridx)
      dstData[ridx] = srcData[ridx - 1];
    dstData[insertIdx] = obj;
    return dstData;
}


function removeEntry(data, index, nElems, forceCopy) {
    let decNE = nElems - 1;
    let retval = forceCopy ? data.slice(0, nextPow2(Math.max(4, decNE))) : data;
    for(let idx = index; idx < decNE; ++idx)
	retval[idx] = data[idx+1];
    //Make sure to zero out the last entry to avoid memory leaks.
    if(decNE < retval.length)
	retval[decNE] = null;
    return retval;
}


const m3_seed = 0
const m3_C1 = 0xcc9e2d51 | 0
const m3_C2 = 0x1b873593 | 0

function rotLeft(val, amt) {
    return val << amt | val >>> (32 - amt);
}

function m3_mix_K1(k1) {
    return Math.imul(m3_C2, rotLeft(Math.imul((k1 | 0), m3_C1), 15));
}

function m3_mix_H1(h1, k1) {
    return ((0xe6546b64 | 0) + Math.imul(5, rotLeft((h1 | 0) ^ (k1 | 0), 13))) | 0;
}


function m3_fmix(h1, len) {
    let s0 = ((h1 | 0) ^ len);
    let s1 = s0 ^ (s0 >>> 16);
    let s2 = Math.imul(s1, (0x85ebca6b | 0));
    let s3 = s2 ^ (s2 >>> 13);
    let s4 = Math.imul(s3, (0xc2b2ae35 | 0));
    return s4 ^ (s4 >>> 16);
}

function mix_collection_hash(hashBasis, count) {
    let h1 = m3_seed;
    let k1 = m3_mix_K1(hashBasis);
    let hh1 = m3_mix_H1(h1, k1);
    return m3_fmix(hh1, count);
}

function objHashCode(hashfn, obj) {
    if(typeof(obj.hashCode) === "function")
	return obj.hashCode();
    else if (Array.isArray(obj))
	return hash_ordered(hashfn, obj);
    else if ((obj instanceof Map) || (obj instanceof Set))
	return hash_unordered(hashfn, obj);
    return hashfn(obj);
}

class UnorderedCollHasher {
    constructor(hash) {
	this.n = 0;
	this.hashCode = 0;
	this.hash = hash;
    }
    accept(val) {
	this.n++;
	this.hashCode = (this.hashCode + objHashCode(this.hash, val)) | 0;
    }
    deref() {
	return mix_collection_hash(this.hashCode, this.n);
    }
}

class OrderedCollHasher {
    constructor(hash) {
	this.n = 0;
	this.hashCode = 1;
	this.hash = hash;
    }
    accept(val) {
	this.n++;
	this.hashCode = (Math.imul(31, this.hashCode) + objHashCode(this.hash, val)) | 0;
    }
    deref() {
	return mix_collection_hash(this.hashCode, this.n);
    }
}

function consumerAccum(acc, v) {
    acc.accept(v); return acc;
}

function noArgInvoker(rfn) {
    return rfn.cljs$core$IFn$_invoke$arity$0 ? rfn.cljs$core$IFn$_invoke$arity$0 : rfn;
}

function oneArgInvoker(rfn) {
    return rfn.cljs$core$IFn$_invoke$arity$1 ? rfn.cljs$core$IFn$_invoke$arity$1 : rfn;
}

function twoArgInvoker(rfn) {
    return rfn.cljs$core$IFn$_invoke$arity$2 ? rfn.cljs$core$IFn$_invoke$arity$2 : rfn;
}

function threeArgInvoker(rfn) {
    return rfn.cljs$core$IFn$_invoke$arity$3 ? rfn.cljs$core$IFn$_invoke$arity$3 : rfn;
}

function iterReduce(hp, rfn, acc, coll) {
    const invoker = twoArgInvoker(rfn);
    const isReduced = hp.isReduced;
    const unreduce = hp.unreduce;
    if(isReduced(acc)) return unreduce(acc);
    if(typeof(coll.next) == "function") {
	for(i = coll.next(); !i.done; i = coll.next()) {
	    acc = invoker(acc, i.value);
	    if(isReduced(acc)) return unreduce(acc);
	}
    } else {
	for(const c of coll) {
	    acc = invoker(acc, c);
	    if(isReduced(acc)) return unreduce(acc);
	}
    }
    return acc;
}


function arrayReduce(hp, rfn, acc, coll) {
    let l = coll.length | 0;
    let invoker = twoArgInvoker(rfn)
    const isReduced = hp.isReduced;
    const unreduce = hp.unreduce;
    for(let idx = 0; idx < l && !isReduced(acc); ++idx)
	acc = invoker(acc, coll[idx]);
    return unreduce(acc);
}


function reduce(hp, rfn, acc, coll) {
    hp = hp == null ? defaultProvider : hp;
    if(coll == null) return hp.unreduce(acc);
    if(Array.isArray(coll)) return arrayReduce(hp, rfn, acc, coll);
    if(typeof(coll.reduce) == "function") return coll.reduce(rfn, acc);
    return iterReduce(hp, rfn, acc, coll);
}


function reduce1(hp, rfn, coll) {
    let first = true;
    const invoker = twoArgInvoker(rfn);
    const rv = reduce(hp, (acc,v)=>{
	if(first) {
	    first = false;
	    return v;
	} else {
	    return invoker(acc, v);
	}
    }, null, coll);
    return first ? rfn() : rv;
}


function hash_ordered(hash, coll) {
    return reduce(null, consumerAccum, new OrderedCollHasher(hash), coll).deref();
}

function cache_ordered(hash, coll) {
    if(coll._hash == null)
	coll._hash = hash_ordered(hash, coll) | 0;
    return coll._hash;
}

function hash_unordered(hash, coll) {
    return reduce(null, consumerAccum, new UnorderedCollHasher(hash), coll).deref();
}

function cache_unordered(hash, coll) {
    if(coll._hash == null)
	coll._hash = hash_unordered(hash, coll) | 0;
    return coll._hash;
}

function jsIter(arg) {
    return (arg == null) ? {next: ()=>{done: true}} : arg[Symbol.iterator]();
}


class Map1Impl {
    constructor(hp, f, arg) {
	this.hp = hp;
	this.f = oneArgInvoker(f);
	this.arg = arg;
	const sz = sizeIfPossible(arg);
	if(sz != null) this.length = sz;
    }
    reduce(rfn, init) {
	rfn = twoArgInvoker(rfn);
	const f = this.f;
	return reduce(this.hp, (acc,v)=>rfn(acc, f(v)), init, this.arg)
    }
    [Symbol.iterator]() {
	let iter = jsIter(this.arg);
	const f = this.f;
	return {
	    next: () => {
		let rv = iter.next();
		return ({done: rv.done,
			 value: rv.done ? undefined : f(rv.value)
			});
	    }
	};
    }
}

function lznc_map_1(hp, f, arg) {
    return new Map1Impl(hp, f, arg);
}


class Map2Impl {
    constructor(hp, f, lhs, rhs) {
	this.f = twoArgInvoker(f);
	this.hp = hp;
	this.lhs = lhs;
	this.rhs = rhs;
	const lsz = sizeIfPossible(lhs);
	const rsz = sizeIfPossible(rhs);
	if(lsz != null && rsz != null) this.length = Math.min(lsz, rsz);
    }
    reduce(rfn, init) {
	return iterReduce(this.hp, rfn, init, this);
    }
    [Symbol.iterator]() {
	const li = jsIter(this.lhs);
	const ri = jsIter(this.rhs);
	const f = this.f;
	return {
	    next: () => {
		const lrv = li.next();
		const rrv = ri.next();
		const d = lrv.done || rrv.done;
		return ({done: d,
			 value: d ? undefined : f(lrv.value, rrv.value)
			});
	    }
	};
    }
}


function lznc_map_2(hp, f, lhs, rhs) {
    return new Map2Impl(hp, f, lhs, rhs);
}


class MapNImpl {
    constructor(hp, f, args) {
	this.hp = hp;
	this.f = f;
	this.args = args;
    }
    reduce(rfn, init) {
	return iterReduce(this.hp, rfn, init, this);
    }
    [Symbol.iterator]() {
	const f = this.f;
	const iters = this.args.map(jsIter);
	const l = iters.length;
	const fnargs = Array(l);
	return ({
	    next: ()=>{
		for(let idx = 0; idx < l; ++idx) {
		    const nval = iters[idx].next();
		    if(nval.done) return {done: true, value: undefined};
		    fnargs[idx] = nval.value;
		}
		return {done: false, value: f(...fnargs)};
	    }});
    }
}

function lznc_map_n(hp, f, args) {
    return new MapNImpl(hp,f,args);
}

class FilterImpl {
    constructor(hp, pred, lhs) {
	this.hp = hp;
	this.pred = oneArgInvoker(pred);
	this.lhs = lhs;
    }
    reduce(rfn, acc) {
	const pred = this.pred;
	const inv = twoArgInvoker(rfn);
	return reduce(this.hp, (acc,v)=>pred(v) ? inv(acc,v) : acc, acc, this.lhs);
    }
    [Symbol.iterator]() {
	const iter = this.lhs[Symbol.iterator]();
	const pred = this.pred;
	return ({next: ()=>{
	    let rv = null;
	    for(rv = iter.next(); rv.done == false && !pred(rv.value); rv=iter.next());
	    const d = rv != null ? rv.done : true;
	    return {done: d, value: d ? undefined : rv.value};
	}});
    }
}

function lznc_filter(hp, pred, lhs) {
    return new FilterImpl(hp, pred,lhs);
}

class ConcatImpl {
    constructor(hp, args) {
	this.hp = hp;
	this.args = args;
    }
    reduce(rfn, acc) {
	rfn = twoArgInvoker(rfn);

	const isReduced = this.hp.isReduced;
	const unreduce = this.hp.unreduce;
	const makeReduced = this.hp.makeReduced;
	const invoker = (acc,v)=>{
	    acc = rfn(acc,v);
	    if(isReduced(acc))
		return makeReduced(acc);
	    return acc;
	}
	for(const coll of this.args) {
	    if(isReduced(acc)) return unreduce(acc);
	    if(coll != null) {
		acc = reduce(this.hp, invoker, acc, coll);
		if(isReduced(acc)) return unreduce(acc);
	    }
	}
	return acc;
    }
    [Symbol.iterator]() {
	const colliter = this.args[Symbol.iterator]();
	let valiter = null;
	class ConcatIter {
	    next() {
		if(valiter != null) {
		    const vv = valiter.next();
		    if(vv.done) valiter = null;
		    else return vv;
		}
		while(valiter == null) {
		    const c = colliter.next();
		    if(c.done) return c;
		    if(c.value != null)
			valiter = c.value[Symbol.iterator]();
		    return this.next();
		}
	    }
	}
	return new ConcatIter();
    }
}

function lznc_concat(hp, args) { return new ConcatImpl(hp, args); }

let LFPPRops = ["length", "0", "1", "toString"];

class LFP {
    get(target, key) {
	switch(key) {
	case "length": return 2;
	case "0": return target.k;
	case "1": return target.v;
	case "hashCode" : return () => target.hashCode();
	case "toString": return () => "[" + target.k + " " + target.v + "]";
	};
	return undefined;
    }
    ownKeys(target) {
	return LFPprops;
    }
    has(target, key) {
	return LFPprops.contains(key);
    }
    getOwnPropertyDescriptor(target, key) {
	switch(key) {
	case "length": return { value: 2, writable: false,
				enumerable: true, configurable: true};
	case "0": return {value: target.k, writable: false,
			  enumerable: true, configurable: true}
	case "1": return {value: target.v, writable: false,
			  enumerable: true, configurable: true}
	case "toString": return {value: this.get(target, "toString"), writable: false,
				 enumerable: true, configurable: true}
	case "hashCode": return {value: this.get(target, "hashCode"), writable: false,
				 enumerable: true, configurable: true}
	}
	return undefined;
    }
}

function leafProxy(lf) {
    return new Proxy(lf, new LFP());
}


class LeafNode {
    constructor(owner, k, v, hash, nextNode) {
	this.owner = owner;
	this.k = k;
	this.v = v;
	this.hashcode = hash;
	this.nextNode = nextNode;
	if(this.hashcode == null)
	    throw new Error("Hashcode undefined");
    }
    static newNode(owner, k, v, hash) {
	owner.incLeaf();
	return new LeafNode(owner, k, v, hash, null);
    }
    clone(nowner) {
	const rv = new LeafNode(nowner, this.k, this.v, this.hashcode, this.nextNode);
	rv.nextNode = rv.nextNode != null ? rv.nextNode.clone(nowner) : null;
	return rv;
    }
    asObject() {
	if(this.proxy == null)
	    this.proxy = leafProxy(this);
	return this.proxy;
    }
    toString() { return "[" + this.k + " " + this.v +"]"; }
    hashCode() {
	if(this.owner.cache_hash)
	    return cache_ordered(this.owner.hash, this);
	else
	    return hash_ordered(this.owner.hash, this);
    }
    getKey() { return this.k; }
    getValue() { return this.v; }
    get(idx) {
	if(idx === 0) return this.k;
	if(idx === 1) return this.v;
	throw Error("Index out of range");
    }
    nth(idx) { return get(idx); }
    nth(idx, d) {
	return idx >= 0 && idx < 2 ? get(idx) : d;
    }
    size() { return 2; }
    getOrCreate(k, hash) {
	if(this.owner.equals(k, this.k))
	    return this;
	if(this.nextNode != null)
	    return this.nextNode.getOrCreate(k, hash);
	else {
	    this.nextNode = LeafNode.newNode(this.owner, k, null, hash);
	    return this.nextNode;
	}
    }
    append(lf) {
	if (this.nextNode == null)
	    this.nextNode = lf;
	else
	    this.nextNode.append(lf);
    }
    remove(k, hash, collapse) {
	if(hash == this.hashcode) {
	    if(this.owner.equals(k, this.k)) {
		this.owner.decLeaf();
		return this.nextNode;
	    }
	    this.nextNode = this.nextNode != null ?
		this.nextNode.remove(k,hash,collapse) :
		null;
	}
	return this;
    }
    setOwner(nowner) {
	if(this.owner == nowner)
	    return this;
	return new LeafNode(nowner, this.k, this.v, this.hashcode, this.nextNode)
    }
    assoc(nowner, shift, k, hash, v) {
	let retval = this.setOwner(nowner);
	if(nowner.equals(k, this.k)) {
	    retval.v = v;
	} else {
	    if(retval.nextNode != null) {
		retval.nextNode = retval.nextNode.assoc(nowner, shift, k, hash, v);
	    } else {
		retval.nextNode = LeafNode.newNode(nowner,k,v,this.hashcode);
	    }
	}
	return retval;
    }
    dissoc(nowner, shift, k, hash, collapse) {
	if(nowner.equals(k, this.k)) {
	    nowner.decLeaf();
	    return this.nextNode;
	}
	let nnode = this.nextNode != null ?
	    this.nextNode.dissoc(nowner,shift,k,hash,collapse) :
	    null;
	if(nnode != this.nextNode) {
	    let retval = this.setOwner(nowner);
	    retval.nextNode = nnode;
	    return retval;
	} else {
	    return this;
	}
    }
    updateValues(owner, bifn) {
	let rv = this.setOwner(owner);
	rv.nextNode = rv.nextNode != null ? rv.nextNode.updateValues(owner,bfn) : null;
	rv.v = bifn(rv.k, rv.v);
	return rv;
    }
    clone(nowner) {
	return new LeafNode(nowner, this.k, this.v, this.hashcode,
			    this.nextNode == null ? null :
			    this.nextNode.clone(nowner));
    }
    iterator() {
	const LeafIter = class {
	    constructor(lf) {
		this.lf = lf;
	    }
	    hasNext() { return this.lf != null; }
	    next() {
		let rv = this.lf;
		this.lf = this.lf.nextNode;
		return rv;
	    }
	}
	return new LeafIter(this);
    }
    reduceLeaves(rfn, acc) {
	let isReduced = this.owner.isReduced;
	for(let lf = this; lf != null && !isReduced(acc); lf = lf.nextNode)
	    acc = rfn(acc, lf);
	return acc;
    }
    [Symbol.iterator]() {
	let idx = 0;
	const p = this;
	return ({
	    next: ()=>{
		let done = idx >= 2;
		let rv = done ? {done: true} :
		    {done: false,
		     value: idx == 0 ? p.k : p.v};
		idx = done ? idx : idx + 1;
		return rv;
	    }
	});
    }
    reduce(rfn, acc) {
	const isReduced = this.owner.isReduced;
	rfn = twoArgInvoker(rfn);
	acc = rfn(acc, this.k);
	if(!isReduced(acc))
	    acc = rfn(acc, this.v);
	return this.owner.unreduce(acc);
    }
}


class BitmapNode {
    constructor(owner, shift, bitmap, data) {
	this.owner = owner;
	this.shift = shift;
	this.bitmap = bitmap;
	this.data = data;
    }
    static newNode(owner,shift,leaf) {
	return new BitmapNode(owner, shift,
			      leaf != null ? bitpos(shift, leaf.hashcode) : 0,
			      Array(leaf, null, null, null));
    }
    clone(nowner) {
	const rv = new BitmapNode(nowner, this.shift, this.bitmap, copyOf(this.data, this.data.length));
	const d = rv.data;
	const l = d.length;
	for(let idx = 0; idx < l; ++idx) {
	    const e = d[idx];
	    if(e != null)
		d[idx]= e.clone(nowner);
	}
	return rv;
    }
    toString() { return "BitmapNode: " + this.shift + " " + bitCount32(this.bitmap); }
    getOrCreate(k, shift, hash) {
	let bpos = bitpos(shift, hash);
	let data = this.data;
	let alen = this.data.length;
	let bm = this.bitmap;
	let index = bitIndex(bm, bpos);
	if((bm & bpos) == 0) {
	    let bmm = bm | bpos;
	    let retval = LeafNode.newNode(this.owner, k, null, hash);
	    this.data = insert(data, retval, index, bitCount32(bmm), false);
	    this.bitmap = bmm;
	    return retval;
	}
	let entry = data[index];
	if(entry instanceof BitmapNode) {
	    return entry.getOrCreate(k, incShift(shift), hash);
	} else {
	    if(entry.hashcode == hash) {
		return entry.getOrCreate(k, hash);
	    } else {
		let nextShift = incShift(shift);
		let node = BitmapNode.newNode(this.owner, nextShift, entry);
		this.data[index] = node;
		return node.getOrCreate(k, nextShift, hash);
	    }
	}
    }
    getNode(k, shift, hash) {
	let bpos = bitpos(shift, hash);
	let bm = this.bitmap;
	if((bm & bpos) != 0) {
	    let index = bitIndex(bm, bpos);
	    let entry = this.data[index];
	    if(entry instanceof BitmapNode) {
		return entry.getNode(k, incShift(shift), hash);
	    } else {
		let hp = this.owner;
		for(let lf = entry; lf != null; lf = lf.nextNode)
		    if(hp.equals(k, lf.k))
			return lf;
	    }
	}
	return null;
    }
    remove(k, hash, collapse) {
	let bpos = bitpos(this.shift, hash);
	let bm = this.bitmap;
	if ((bm & bpos) != 0) {
	    let data = this.data;
	    let index = bitIndex(bm,bpos);
	    let entry = this.data[index];
	    let nentry = entry.remove(k, hash, true);
	    if(nentry == null) {
		let nbm = bm & (~bpos);
		if(nbm == 0 && collapse)
		    return null;
		this.bitmap = nbm;
		this.data = removeEntry(data, index, bitCount32(bm), false);
	    } else {
		this.data[index] = nentry;
	    }
	}
	return this;
    }
    setOwner(nowner) {
	if(this.owner == nowner)
	    return this;
	return new BitmapNode(nowner, this.shift, this.bitmap, this.data);
    }
    assoc(nowner, shift, k, hash, v) {
	let forceCopy = this.owner != nowner;
	let retval = this.setOwner(nowner);
	let bpos = bitpos(shift, hash);
	let bm = this.bitmap;
	let index = bitIndex(bm, bpos);
	if((bm & bpos) != 0) {
	    let data = forceCopy ? copyOf(this.data, this.data.length) : this.data;
	    let entry = this.data[index];
	    if (entry instanceof BitmapNode) {
		data[index] = entry.assoc(nowner, incShift(shift), k, hash, v);
	    } else {
		if (hash == entry.hashcode) {
		    data[index] = entry.assoc(nowner, shift, k, hash, v);
		} else {
		    let nshift = incShift(shift);
		    let nnode = BitmapNode.newNode(nowner, nshift, curEntry);
		    data[index] = nnode.assoc(nowner, nshift, k, hash, v);
		}
	    }
	    retval.data = data;
	    return retval;
	} else {
	    let nbm = bm | bpos;
	    retval.data = insert(this.data, LeafNode.newNode(nowner, k, v, hash), index,
				 bitCount32(nbm), forceCopy);
	    retval.bitmap = nbm;
	}
	return retval;
    }
    dissoc(nowner, shift, k, hash, collapse) {
	let bpos = bitpos(shift, hash);
	let bm = this.bitmap;
	let forceCopy = this.owner != nowner;
	if((bm & bpos) != 0) {
	    let index = bitIndex(bm, bpos);
	    let entry = this.data[index];
	    let retval = this.setOwner(nowner);
	    let nentry = entry.dissoc(nowner, incShift(shift), k, hash, collapse);
	    if(nentry == null) {
		let nbm = bm & (~bpos);
		if(nbm == 0 && collapse)
		    return null;
		retval.data = removeEntry(this.data, index, bitCount32(bm), forceCopy);
		retval.bitmap = nbm;
	    } else {
		let data = forceCopy ? copyOf(this.data, this.data.length) : this.data;
		data[index] = nentry;
		retval.data = data;
	    }
	    return retval;
	} else {
	    return this;
	}
    }
    updateValues(owner, bifn) {
	let rv = this.setOwner(owner);
	if(this != rv)
	    rv.data = copyOf(rv.data, rv.data.length);

	let l = bitCount32(this.bitmap);
	let d = rv.data;
	for(let idx = 0; idx < l; ++idx) {
	    d[idx] = d[idx].updateValues(owner,bfn);
	}
	return rv;
    }
    iterator() {
	const BMIter = class {
	    constructor(bitmap,data) {
		this.nElems = bitCount32(bitmap);
		this.idx = 0;
		this.data = data;
		this.iter = null;
	    }
	    hasNext() {
		return this.idx < this.nElems || (this.iter != null && this.iter.hasNext());
	    }
	    next() {
		let iter = this.iter;
		if (iter == null || !iter.hasNext()) {
		    this.iter = this.data[this.idx].iterator();
		    this.idx++;
		}
		return this.iter.next();
	    }
	};
	return new BMIter(this.bitmap, this.data);
    }
    reduceLeaves(rfn, acc) {
	let nnodes = bitCount32(this.bitmap);
	let data = this.data;
	let isReduced = this.owner.isReduced;
	for (let idx = 0; idx < nnodes && !isReduced(acc); ++idx)
	    acc = data[idx].reduceLeaves(rfn, acc);
	return acc;
    }
}


function mapProxy(m) {
    return new Proxy(m, {
	get(target, key) {
	    return target.get(key);
	},
	set(target, key, value) {
	    n = target.getOrCreate(key);
	    n.v = value;
	    return n.v;
	},
	deleteProperty(target, key) {
	    return target.remove(key);
	},
	ownKeys(target) {
	    return target.reduce((acc,v)=>{acc.push(v.getKey()); return acc}, Array());
	},
	has(target, key) {
	    return target.containsKey(key);
	},
	defineProperty(target, key, descriptor) {
	    if (descriptor && "value" in descriptor) {
		target.put(key, descriptor.value);
	    }
	    return target;
	},
	getOwnPropertyDescriptor(target, key) {
	    let n = target.getNode(key);
	    return n != null ? {
		value: n.v,
		writable: true,
		enumerable: true,
		configurable: true,
	    } : undefined;
	},
	apply(target, ...args) {
	    if(args.length == 1)
		return target.get(args[0]);
	    if(args.length == 2)
		return target.getOrDefault(args[0], args[1]);
	}
    });
}

function nilstr(v) { return v == null ? "nil" : v; }

//marker iface
class MapBase {
    size() { return this.count; }
    isEmpty() { return this.count == 0; }
    asObject() {
	if(this.proxy == null)
	    this.proxy = mapProxy(this);
	return this.proxy;
    }
    hashCode() {
	let p = this;
	//Specialized pathway because leaves implement hashCode.  js Arrays return a random
	//number every time hash is called.
	return hash_unordered(this.hash, {reduce(rfn, acc) {
	    return p.reduceLeaves(rfn,acc);
	}});
    }
    put(k,v) {
	let lf = this.getOrCreate(k);
	lf.v = v;
    }
    set(k,v) { put(k,v); }
    get(k) {
	let lf = this.getNode(k);
	return lf != null ? lf.v : null;
    }
    getOrDefault(k, d) {
	let lf = this.getNode(k);
	return lf != null ? lf.v : d;
    }
    containsKey(k) { return this.getNode(k) != null; }
    has(k) { return containsKey(k); }
    delete(k) { return remove(k); }
    computeIfAbsent(k, f) {
	let n = this.getOrCreate(k);
	if(n.v == null)
	    n.v = f(k);
	return n.v;
    }
    computeIfPresent(k, bifn) {
	let n = this.getNode(k);
	if(n != null) {
	    n.v = f(k,n.v);
	    return n.v;
	}
	return null;
    }
    compute(k, bifn) {
	let n = this.getOrCreate(k);
	n.v = bifn(k, n.v);
	return n.v;
    }
    forEach(cback) {
	let m = this;
	this.reduceLeaves((cback, e)=>{cback(e.getValue(), e.getKey(), m); return cback},
			  cback);
    }
    call(m, ...args) {
	if(args.length == 1)
	    return this.get(args[0]);
	if(args.length == 2)
	    return this.getOrDefault(args[0], args[1]);
	throw Error("Invalid invocation");
    }
    meta() { return this.meta; }
    withMeta(m) {
	let retval = this.shallowClone();
	retval.meta = m;
	return retval;
    }
    leaves() {
	const p = this;
	return ({length: p.count,
		 reduce: (rfn,init)=>p.reduceLeaves(rfn, init),
		 [Symbol.iterator]: ()=>{
		     const i = p.iterator();
		     return ({next: ()=>{const hn=i.hasNext();
					 return {done: !hn, value: hn ? i.next() : undefined};}})
		 }
		});
    }
    keySet() {
	const p = this;
	let rv = lznc_map_1(this.hp, (e)=>e.k, this.leaves());
	rv.contains = (k)=>p.containsKey(k);
	return rv;
    }
    entrySet() {
	const p = this;
	const eq = this.hp.equals;
	let rv = lznc_map_1(this.hp, (e)=>Array(e.k, e.v), this.leaves());
	rv.contains = (kv)=> {
	    const n = this.getNode(kv[0]);
	    if(n) return eq(kv[1], n.v);
	    return false;
	};
	return rv;
    }
    keys() {return this.keySet()}
    values() {return lznc_map_1(this.hp, (e)=>e.v, this.leaves()); }
    entries() {return this.entrySet();}
    //Iteration matches a javascript map
    [Symbol.iterator]() {
	return this.entries()[Symbol.iterator]();
    }
    reduce(rfn, acc) {
	return this.leaves().reduce(rfn, acc);
    }

    toString() {
	return this.reduceLeaves((acc, v) => { return (acc.length == 1) ?
					       acc + nilstr(v.getKey()) + " " + nilstr(v.getValue()) :
					       acc + ", " + nilstr(v.getKey()) + " " + nilstr(v.getValue())},
				 "{") + "}";
    }
};


class BitmapTrie extends MapBase {
    constructor(hashProvider, nullLeaf, root, count) {
	super();
	this.hp = hashProvider;
	this.hash = hashProvider.hash;
	this.equals = hashProvider.equals;
	this.isReduced = hashProvider.isReduced;
	this.unreduce = hashProvider.unreduce;
	this.print = hashProvider.print;
	this.root = root != null ? root : BitmapNode.newNode(this, 0, null);
	this.nullLeaf = nullLeaf;
	this.count = count;
	this.incLeaf = () => this.count++;
	this.decLeaf = () => this.count--;
    }
    static newTrie(hashProvider) {
	return new BitmapTrie(hashProvider, null, null, 0)
    }
    getOrCreate(k) {
	let hash = this.hash(k);
	if(k == null) {
	    if(this.nullLeaf == null)
		this.nullLeaf = new LeafNode(this, k, 0);
	    return this.nullLeaf;
	}
	return this.root.getOrCreate(k, 0, hash);
    }
    getNode(k) {
	let hash = this.hash(k);
	if(k == null)
	    return this.nullLeaf;
	return this.root.getNode(k, 0, hash);
    }
    reduceLeaves(rfn, acc) {
	const isReduced = this.hp.isReduced;
	const unreduce = this.hp.unreduce;
	const invoker = twoArgInvoker(rfn);
	if(this.nullEntry != null && !isReduced(acc))
	    acc = invoker(acc, nullEntry);
	return unreduce(this.root.reduceLeaves(invoker, acc));
    }
    remove(k) {
	let c = this.count;
	if(k == null) {
	    if(this.nullLeaf != null) {
		this.count--;
		this.nullLeaf = null;
	    }
	} else
	    this.root.remove(k, this.hp.hash(k), false);
	return c != this.count;
    }
    shallowClone() {
	return new BitmapTrie(this.hp, this.nullEntry, this.root, this.count);
    }
    clone() {
	const rv = this.shallowClone();
	if(rv.nullEntry != null)
	    rv.nullEntry = rv.nullEntry.clone(rv);
	rv.root = rv.root.clone(rv);
	return rv;
    }
    mutAssoc(k, v) {
	if(k == null) {
	    if(nullEntry == null)
		this.put(k,v);
	    else {
		this.nullEntry = this.nullEntry.assoc(this, 0, k, 0, v);
	    }
	} else {
	    this.root = this.root.assoc(this, 0, k, this.hp.hash(k), v);
	}
	return this;
    }
    mutDissoc(k) {
	if(k == null) {
	    if(this.nullEntry != null)
		this.nullEntry = this.nullEntry.dissoc(this, 0, k, 0, false);
	} else {
	    this.root = this.root.dissoc(this, 0, k, this.hp.hash(k), false);
	}
	return this;
    }
    mutUpdateValues(bfn) {
	if(this.nullEntry != null)
	    this.nullEntry = this.nullEntry.updateValues(this, bfn);
	this.root = this.root.updateValues(this, bfn);
    }
    iterator() {
	const TrieIter = class {
	    constructor(nullEntry, root) {
		this.nullEntry = nullEntry;
		this.rootIter = root.iterator();
	    }
	    hasNext() {
		return this.nullEntry != null || this.rootIter.hasNext();
	    }
	    next() {
		let rval = this.nullEntry != null ? this.nullEntry : this.rootIter.next();
		this.nullEntry = null;
		return rval;
	    }
	}
	return new TrieIter(this.nullEntry, this.root);
    }
}


function makeBitmapTrie(hashProvider) {
    hashProvider = hashProvider == null ? defaultProvider : hashProvider;
    return BitmapTrie.newTrie(hashProvider);
}

class HashTable extends MapBase {
    constructor(hashProvider, loadFactor, initialCapacity, count, data) {
	super();
	this.loadFactor = loadFactor;
	this.capacity = nextPow2(initialCapacity);
	this.mask = (this.capacity - 1) | 0;
	this.threshold = Math.floor(this.loadFactor * this.capacity) | 0;
	this.data = data == null ? Array(this.capacity) : data;
	this.count = count == null ? 0 : count;
	this.hp = hashProvider;
	this.hash = hashProvider.hash;
	this.equals = hashProvider.equals;
	this.incLeaf = () => this.count++;
	this.decLeaf = () => this.count--;
    }
    static newHashTable(hashProvider, loadFactor, initialCapacity) {
	return new HashTable(hashProvider, loadFactor, initialCapacity, 0, null);
    }
    checkResize(node) {
	if(this.count >= this.threshold) {
	    const oldData = this.data;
	    const newcap = this.capacity * 2
	    this.capacity = newcap;
	    this.threshold = Math.floor(this.capacity * this.loadFactor) | 0;
	    this.data = Array(newcap);
	    this.mask = (newcap - 1) | 0;
	    const newData = this.data;
	    const oldCap = oldData.length;
	    const mask = newcap - 1;
	    for(let idx = 0; idx < oldCap; ++idx) {
		let lf = oldData[idx];
		if(lf != null) {
		    oldData[idx] = null;
		    //Common case
		    if(lf.nextNode == null) {
			newData[lf.hashcode & mask] = lf;
		    } else {
			//Because capacity only grows by powers of 2, we can split
			//the nodes up into high bit and low bit linked lists as we
			//added one bit to the capacity.  We create these lists here
			//and simply set them to the correct location once.  This
			//avoids reading from the new data array.
			let loHead = null, loTail = null, hiHead = null, hiTail = null;
			do {
			    if((lf.hashcode & oldCap) == 0) {
				if(loTail == null) loHead = lf;
				else loTail.nextNode = lf;
				loTail = lf;
			    } else {
				if(hiTail == null) hiHead = lf;
				else hiTail.nextNode = lf;
				hiTail = lf;
			    }
			    lf = lf.nextNode;
			} while(lf != null);
			if(loHead != null) {
			    loTail.nextNode = null;
			    newData[idx] = loHead;
			}
			if(hiHead != null) {
			    hiTail.nextNode = null;
			    newData[idx+oldCap] = hiHead;
			}
		    }
		}
	    }
	}
	return node;
    }
    getOrCreate(k) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let ee = null, e = null;
	for(e = this.data[bucket]; e != null && !((e.k == k) || this.equals(e.k, k)); e = e.nextNode)
	    ee = e;
	if(e != null) {
	    return e;
	} else {
	    let lf = LeafNode.newNode(this,k,null,hashcode);
	    if(ee != null)
		ee.nextNode = lf;
	    else
		this.data[bucket] = lf;
	    return this.checkResize(lf);
	}
    }
    getNode(k) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	for(let lf = this.data[bucket]; lf != null; lf = lf.nextNode) {
	    if(this.equals(lf.k, k))
		return lf;
	}
	return null;
    }
    remove(k) {
	let sz = this.size();
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let entry = this.data[bucket];
	if(entry != null)
	    this.data[bucket] = entry.remove(k, hashcode, true);
	return sz != this.size();
    }
    //Override compute to provide higher performance
    compute(k, bifn) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let ee = null, e = null;
	for(e = this.data[bucket]; e != null && !((e.k == k) || this.equals(e.k, k)); e = e.nextNode)
	    ee = e;
	let newv = bifn(k, e != null ? e.v : null);
	if(e != null) {
	    if(newv != null)
		e.v = newv;
	    else
		remove(k);
	} else {
	    let lf = new LeafNode(this, k, newv, hashcode, null);
	    if(ee != null)
		ee.nextNode = lf;
	    else
		this.data[bucket] = lf;
	    this.incLeaf();
	    this.checkResize(null);
	}
	return newv;
    }
    computeIfAbsent(k, fn) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let ee = null, e = null;
	for(e = this.data[bucket]; e != null && !((e.k == k) || this.equals(e.k, k)); e = e.nextNode)
	    ee = e;
	if(e != null) {
	    return e.v;
	} else {
	    let newv = fn(k);
	    let lf = new LeafNode(this,k,newv,hashcode,null);
	    if(ee != null)
		ee.nextNode = lf;
	    else
		this.data[bucket] = lf;
	    this.incLeaf();
	    return this.checkResize(newv);
	}
    }

    shallowClone() {
	return new HashTable(this.hp, this.loadFactor, this.capacity, this.count,
			     copyOf(this.data, this.data.length));
    }

    clone() {
	let rv = this.shallowClone();
	let data = rv.data;
	let ne = data.length;
	for (let idx = 0; idx < ne; ++idx) {
	    let entry = data[idx];
	    if (entry != null)
		data[idx] = entry.clone(rv);
	}
	return rv;
    }

    mutAssoc(k, v) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let entry = this.data[bucket];
	this.data[bucket] = entry == null ?
	    LeafNode.newNode(this, k, v, hashcode) :
	    entry.assoc(this, 0, k, hashcode, v);
	return this;
    }

    mutDissoc(k) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let entry = this.data[bucket];
	if(entry != null)
	    this.data[bucket] = entry.dissoc(this, 0, k, hashcode, true);
	return this;
    }

    mutUpdateValues(bfn) {
	let d = this.data;
	let l = d.length;
	for(let idx = 0; idx < l; ++idx) {
	    let e = d[idx];
	    if (e != null)
		d[idx] = e.updateValues(this, bfn);
	}
	return this;
    }

    iterator() {
	let TableIter = class {
	    constructor(data) {
		this.dlen = data.length;
		this.data = data;
		this.idx = 0;
		this.advance();
	    }
	    advance() {
		if(this.lf != null)
		    this.lf = this.lf.nextNode;
		if(this.lf == null) {
		    let ne = this.dlen;
		    let data = this.data;
		    for(let idx = this.idx; idx < ne; ++idx) {
			let lf = data[idx];
			if(lf != null) {
			    this.lf = lf;
			    this.idx = idx+1;
			    return;
			}
		    }
		    this.idx = this.dlen;
		}
	    }
	    hasNext() {
		return this.lf != null;
	    }
	    next() {
		let rv = this.lf;
		this.advance();
		return rv;
	    }
	};
	return new TableIter(this.data);
    }
    reduceLeaves(rfn, acc) {
	if(this.count != 0) {
	    const data = this.data;
	    const nData = data.length;
	    const isReduced = this.hp.isReduced;
	    const invoker = twoArgInvoker(rfn);
	    for(let idx = 0; idx < nData && !isReduced(acc); ++idx) {
		for(let lf = data[idx]; lf != null && !isReduced(acc); lf = lf.nextNode) {
		    acc = invoker(acc, lf);
		}
	    }
	}
	return this.hp.unreduce(acc);
    }
}

function makeHashTable(hashProvider, capacity, loadFactor) {
    let hp = hashProvider != null ? hashProvider : defaultHashProvider;
    let initCap = capacity != null ? capacity : 16;
    let lf = loadFactor != null ? loadFactor : 0.75;
    return HashTable.newHashTable(hp, lf, initCap);
}


function identityGroupByRfn(initFn, reducer) {
    const rfn = (k,v)=>reducer(v == null ? initFn() : v, k);
    return (m,v)=>{m.compute(v, rfn); return m;}
}

function keyFnGroupByRfn(hp, keyFn, initFn, reducer) {
    return (m,v)=>{m.compute(keyFn(v), (k,vv)=>reducer(vv == null ? initFn() : vv, v));
		   return m;}
}


function groupByReduce(hp, mapFn, keyFn, initFn, rfn, finFn, coll) {
    const invoker = twoArgInvoker(rfn);
    const rf = keyFn == null ? identityGroupByRfn(noArgInvoker(initFn),invoker)
	  : keyFnGroupByRfn(hp, oneArgInvoker(keyFn), noArgInvoker(initFn), invoker);
    const rv = reduce(hp, rf, mapFn(), coll);
    const ff = finFn == null ? null : oneArgInvoker(finFn);
    return ff == null ? rv : rv.reduceLeaves((acc,n)=>{n.v = ff(n.v); return acc}, rv);
}


exports.copyOf = copyOf;
exports.mask = mask;
exports.bitpos = bitpos;
exports.bitIndex = bitIndex;
exports.nextPow2 = nextPow2;
exports.insert = insert;
exports.defaultHash = defaultHash;
exports.sizeIfPossible = sizeIfPossible;
exports.makeTrie = makeBitmapTrie;
exports.makeHashTable = makeHashTable;
exports.mapProxy = mapProxy;
exports.rotLeft = rotLeft;
exports.m3_mix_K1 = m3_mix_K1;
exports.m3_mix_H1 = m3_mix_H1;
exports.m3_fmix = m3_fmix;
exports.hash_ordered = hash_ordered;
exports.cache_ordered = cache_ordered;
exports.hash_unordered = hash_unordered;
exports.cache_unordered = cache_unordered;
exports.mix_collection_hash = mix_collection_hash;
exports.objHashCode = objHashCode
exports.reduce1 = reduce1;
exports.reduce = reduce;
exports.defaultProvider = defaultProvider;
exports.groupByReduce = groupByReduce;
exports.oneArgInvoker = oneArgInvoker;
exports.twoArgInvoker = twoArgInvoker;
exports.threeArgInvoker = threeArgInvoker;
exports.lznc_map_1 = lznc_map_1;
exports.lznc_map_2 = lznc_map_2;
exports.lznc_map_n = lznc_map_n;
exports.lznc_concat = lznc_concat;
exports.lznc_filter = lznc_filter;
exports.BitmapTrie = BitmapTrie;
exports.LeafNode = LeafNode;
exports.HashTable = HashTable;
exports.Map1Impl = Map1Impl;
exports.Map2Impl = Map2Impl;
exports.MapNImpl = MapNImpl;
exports.FilterImpl = FilterImpl;
exports.ConcatImpl = ConcatImpl;
