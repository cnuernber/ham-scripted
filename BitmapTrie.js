const cyrb53 = (str, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (h1 >>> 0);
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
    rval = 1 << 31 - Math.clz32(n);
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
    srcLen = srcData.length;
    dstLen = nextPow2(newLen);
    copy = forceCopy || dstLen > srcLen;
    dstData = copy ? copyOf(srcData, dstLen) : srcData;
    for(ridx = newLen-1; ridx > insertIdx; --ridx)
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



let m3_seed = 0
let m3_C1 = 0xcc9e2d51 | 0
let m3_C2 = 0x1b873593 | 0

function rotLeft(val, amt) {
    return val << amt | val >>> (32 - amt);
}

function m3_mix_K1(k1) {
    return Math.imul(m3_C2, rotLeft(Math.imul((k1 | 0), m3_C1), 15));
}


// (defn ^number m3-mix-H1 [h1 k1]
//   (int (-> (int h1) (bit-xor (int k1)) (int-rotate-left 13) (imul 5) (+ (int 0xe6546b64)))))
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

function tmap(f, r) {
    return {
	reduce(rfn, acc) {
	    return r.reduce((acc,v) => rfn(acc, f(v)), acc);
	},
	[Symbol.iterator]() {
	    let iter = r[Symbol.iterator]();
            return {
		next: () => {
		    let rv = iter.next();
		    return ({value: rv.done ? undefined : f(rv.value),
			     done: rv.done});
		}
            }
	}
    };
}


function reduce(rfn, init, coll) {
    if(coll == null) return init;
    let r = coll["reduce"];
    if(typeof r === 'function')
	return coll.reduce(rfn,init);
    for(const v of coll) {
	init = rfn(init, v);
    }
    return init;
}

function hash_ordered(hash, coll) {
    return reduce(consumerAccum, new OrderedCollHasher(hash), coll).deref();
}

function hash_unordered(hash, coll) {
    return reduce(consumerAccum, new UnorderedCollHasher(hash), coll).deref();
}

function cache_hash_unordered(coll) {
    if(coll._hash == null)
	coll._hash = hash_unordered(coll) | 0;
    return coll._hash;
}


class LeafNode {
    constructor(owner, k, v, hash, nextNode) {
	this.owner = owner;
	this.k = k;
	this.v = v;
	this.hashcode = hash;
	this.nextNode = nextNode;
	if(this.hashcode == null)
	    throw "Hashcode undefined";
    }
    static newNode(owner, k, hash) {
	owner.incLeaf();
	return new LeafNode(owner, k, k, hash, null);
    }
    toString() { return "LeafNode: " + this.k + " " + this.hashcode; }
    hashCode() {
	let p = this;
	return hash_ordered(this.owner.hash,
			    {reduce(rfn,acc) { return rfn(rfn(acc,p.k), p.v); }});
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
	    return this.nextNode.getOrCreate(k);
	else {
	    this.nextNode = LeafNode.newNode(this.owner, k, hash);
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
	retval = this.setOwner(nowner);
	if(nowner.equals(k, this.k)) {
	    this.v = v;
	} else {
	    if(retval.nextNode != null) {
		retval.nextNode = retval.nextNode.assoc(nowner, shift, k, hash, v);
	    } else {
		retval.nextNode = LeafNode.newNode(nowner,k,this.hashcode);
		retval.nextNode.v = v;
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
    toString() { return "BitmapNode: " + this.shift + " " + bitCount32(this.bitmap); }
    getOrCreate(k, shift, hash) {
	let bpos = bitpos(shift, hash);
	let data = this.data;
	let alen = this.data.length;
	let bm = this.bitmap;
	let index = bitIndex(bm, bpos);
	if((bm & bpos) == 0) {
	    let bmm = bm | bpos;
	    let retval = LeafNode.newNode(this.owner, k, hash);
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
	    let curEntry = this.data[index];
	    if (curEntry instanceof BitmapNode) {
		data[index] = curEntry.assoc(nowner, incShift(shift), k, hash, v);
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
	    retval.data = insert(this.data, LeafNode.newNode(nowner, k, hash), index,
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


//marker iface
class MapBase {
    size() { return this.count; }
    isEmpty() { return this.count == 0; }
    asObject() { return mapProxy(this); }
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
    [Symbol.iterator]() {
        let iter = this.iterator();
	let valary = (e) => Array(e.getKey(), e.getValue());
        return {
            next: () => {
		let hn = iter.hasNext();
		return ({value: hn ? valary(iter.next()) : undefined,
			 done: !hn});
	    }
        }
    }

    reduce(rfn, acc) {
	return this.reduceLeaves((acc, v)=>rfn(acc, Array(v.getKey(), v.getValue())), acc);
    }

    toString() {
	return this.reduceLeaves((acc, v) => { return (acc.length == 1) ?
					       acc + v.getKey() + " " + v.getValue() :
					       acc + ", " + v.getKey() + " " + v.getValue()},
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
	let isReduced = this.hp.isReduced;
	let unreduce = this.hp.unreduce;
	if(this.nullEntry != null && !isReduced(acc))
	    acc = rfn(acc, nullEntry);
	return unreduce(this.root.reduceLeaves(rfn, acc));
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
	    let oldData = this.data;
	    let newcap = this.capacity * 2
	    this.capacity = newcap;
	    this.threshold = Math.floor(this.capacity * this.loadFactor) | 0;
	    this.data = Array(newcap);
	    this.mask = (newcap - 1) | 0;
	    let newData = this.data;
	    let dlen = oldData.length;
	    let mask = newcap - 1;
	    for(let idx = 0; idx < dlen; ++idx) {
		for(let lf = oldData[idx]; lf != null; lf = lf.nextNode) {
		    let bucket = lf.hashcode & mask;
		    let entry = newData[bucket];
		    if(entry == null)
			newData[bucket] = lf;
		    else {
			entry.append(lf);
		    }
		}
	    }
	}
	return node;
    }
    getOrCreate(k) {
	let hashcode = this.hash(k);
	let bucket = hashcode & this.mask;
	let entry = this.data[bucket];
	if (entry == null) {
	    let rv = LeafNode.newNode(this, k, hashcode);
	    this.data[bucket] = rv;
	    return this.checkResize(rv);
	}
	else {
	    return this.checkResize(entry.getOrCreate(k, hashcode));
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
		  LeafNode.newNode(this, k, hashcode) :
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
	let isReduced = this.hp.isReduced;
	let data = this.data;
	let nData = data.length;
	if(this.count != 0) {
	    for(let idx = 0; idx < nData && !isReduced(acc); ++idx) {
		for(let lf = data[idx]; lf != null && !isReduced(acc); lf = lf.nextNode) {
		    acc = rfn(acc, lf);
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


module.exports.copyOf = copyOf;
module.exports.mask = mask;
module.exports.bitpos = bitpos;
module.exports.bitIndex = bitIndex;
module.exports.nextPow2 = nextPow2;
module.exports.insert = insert;
module.exports.defaultHash = defaultHash;
module.exports.makeTrie = makeBitmapTrie;
module.exports.makeHashTable = makeHashTable;
module.exports.mapProxy = mapProxy;
module.exports.rotLeft = rotLeft;
module.exports.m3_mix_K1 = m3_mix_K1;
module.exports.m3_mix_H1 = m3_mix_H1;
module.exports.m3_fmix = m3_fmix;
module.exports.hash_ordered = hash_ordered;
module.exports.hash_unordered = hash_unordered;
module.exports.mix_collection_hash = mix_collection_hash;
module.exports.objHashCode = objHashCode
module.exports.reduce = reduce;
