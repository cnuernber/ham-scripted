let bm = require("./BitmapTrie.js");


function indexedAccum(rfn, inN) {
    let n = (inN != null ? inN : 0) | 0;
    const rf = bm.threeArgInvoker(rfn);
    return (acc,v) => rf(acc,n++,v);
}


class ChunkedVector {
    constructor(hp) {
	this.hp = hp;
	this.length = 0;
	this.capacity = 0;
	this.data = Array();
    }
    size() { return this.length; }
    ensureCapacity(newLen) {
	if(newLen > this.capacity) {
	    newLen = newLen <= 32 ? bm.nextPow2(Math.max(4, newLen)) : (32 * Math.ceil(newLen/32)) | 0;
	    let nChunks = Math.floor((newLen+31) / 32) | 0;
	    let oldNChunks = Math.floor((this.length+31)/32) | 0;
	    this.data.length = nChunks;
	    for(let idx = oldNChunks; idx < nChunks; ++idx) {
		let curChunk = this.data[idx];
		let nextLen = idx == nChunks-1 ? newLen % 32 : 32;
		let nextChunk = curChunk == null ? Array(nextLen) : bm.copyOf(curChunk, nextLen);
		nextChunk.owner = this;
		this.data[idx] = nextChunk;
	    }
	    this.capacity = newLen;
	}
	return this.data;
    }
    add(v) {
	let l = this.length;
	let data = this.ensureCapacity(l+1);
	data[Math.floor(l/32)][l%32] = v;
	this.length++;
    }
    get(idx) {
	if(idx >= this.length)
	    throw Error("Index out of range: " + idx + " : " + this.length);
	return this.data[Math.floor(idx/32)|0][idx%32];
    }
    set(idx,v) {
	if(idx >= this.length)
	    throw Error("Index out of range: " + idx + " : " + this.length);
	this.data[Math.floor(idx/32)|0][idx%32] = v;
    }
    addAll(newData) {
	if(newData == null) return;
	let sz = bm.sizeIfPossible(newData);
	let len = this.length;
	if(sz) {
	    let nl = len + sz;
	    if(Array.isArray(newData)) {
		let newDLen = Math.ceil(nl/32) | 0;
		let data = this.data;
		data.length = newDLen;
		for(let idx = len; idx < nl; idx += 32) {
		    let cidx = Math.floor(idx/32)|0;
		    let cstart = idx % 32;
		    let clen = Math.min(32-cstart, nl - idx);
		    let chunk = data[cidx];
		    let doff = idx - len;
		    let dchunk = newData.slice(doff, doff+clen);
		    if(chunk != null) {
			//resize chunk
			chunk.length = cstart;
			for(let lidx = 0; lidx < clen; ++lidx)
			    chunk.push(dchunk[lidx])
		    } else {
			data[cidx] = dchunk;
		    }
		    //mod32 align idx
		    idx -= cstart;
		}
	    } else {
		let data = this.ensureCapacity(nl);
		bm.reduce(null,
			  indexedAccum((data,idx,v)=> { let ll = len + idx;
							data[Math.floor(ll/32)][ll%32] = v;
							return data}), data, newData);
	    }
	    this.length = nl;
	} else {
	    bm.reduce(null, (cv,v) => { cv.add(v); return cv}, this, newData);
	}
    }
    toString() {
	return this.reduce((acc,v) => acc + (acc.length > 1 ? ", " + v : v), "[") + "]";
    }
    reduce(rfn, init) {
	rfn = bm.twoArgInvoker(rfn);
	const isReduced = this.hp.isReduced;
	const l = this.length;
	const d = this.data;
	const nc = Math.ceil(l/32) | 0;
	let acc = init;
	if(isReduced(acc))
	    return this.up.unreduce(acc);
	for (let idx = 0; idx < nc; ++idx) {
	    const chunk = d[idx];
	    const clen = Math.min(32, l-(idx*32)) | 0;
	    for(let cidx = 0; cidx < clen; ++cidx) {
	     	acc = rfn(acc, chunk[cidx]);
		if(isReduced(acc))
		    return this.hp.unreduce(acc);
	    }
	}
	return acc;
    }
    [Symbol.iterator]() {
	let l = this.length;
	let idx = 0;
	let data = this.data;
        return {
	    next: () => {
		let done = idx >= l;
		let rv = ({value: done ? undefined : data[Math.floor(idx/32)][idx%32],
			   done: done});
		++idx;
		return rv;
	    }
        }
    }
    toArray() {
	let data = this.data;
	return this.reduce(indexedAccum((rv,idx,v)=> {
	    rv[idx] = v; return rv;
	}), Array(this.length));
    }
}

function addVal(lhs, rhs) {
    return lhs + rhs;
}

class Range {
    constructor(start,end,step,hp) {
	this.start = start;
	this.end = end;
	this.step = step;
	this.length = Math.max(0, Math.floor((end-start)/step));
	this.hp = hp;
    }
    hashCode() { return bm.cached_ordered(this.hp.hash, this); }
    size() { return this.length; }
    reduce(rfn,acc) {
	const isReduced = this.hp.isReduced;
	const unreduce = this.hp.unreduce;
	const invoker = bm.twoArgInvoker(rfn);
	const l = this.length;
	const start = this.start;
	const step = this.step;
	for(let idx = 0; idx < l && !isReduced(acc); ++idx)
	    acc = invoker(acc, start+(step*idx));
	return unreduce(acc);
    }
    [Symbol.iterator]() {
	const l = this.length;
	const start = this.start;
	const step = this.step;
	let idx = 0;
	return {
	    next: () => {
		let done = idx >= l;
		let rv = ({value: done ? undefined : start+(step*idx),
			   done: done});
		++idx;
		return rv;
	    }
	}
    }
}


function range(start,end,step,hp) {
    return new Range(start,end,step,hp);
}


class Sum {
    constructor() {
	this.n = 0;
	this.s = 0;
    }
    accept(v) { this.n++; this.s += v; }
    deref() { return this; }
}

class MMaxKey {
    constructor(ifn) {
	this.k = null;
	this.v = null;
	this.ifn = bm.oneArgInvoker(ifn);
    }
    accept(v) {
	if(this.k == null) {
	    this.k = this.ifn(v);
	    this.v = v;
	} else {
	    const kk = this.ifn(v);
	    if(kk >= this.k) {
		this.k = kk;
		this.v = v;
	    }
	}
    }
    deref() { return this.v; }
}

class MMinKey {
    constructor(ifn) {
	this.k = null;
	this.v = null;
	this.ifn = bm.oneArgInvoker(ifn);
    }
    accept(v) {
	if(this.k == null) {
	    this.k = this.ifn(v);
	    this.v = v;
	} else {
	    const kk = this.ifn(v);
	    if(kk <= this.k) {
		this.k = kk;
		this.v = v;
	    }
	}
    }
    deref() { return this.v; }
}

module.exports.indexedAccum = indexedAccum;
module.exports.makeChunkedVec = (hp) => new ChunkedVector(hp);
module.exports.addVal = (a,b) => a + b;
module.exports.decVal = (a,b) => a - b;
module.exports.range = range;
module.exports.sum = () => new Sum();
module.exports.mmax_key = (fn) => new MMaxKey(fn);
module.exports.mmin_key = (fn) => new MMinKey(fn);
