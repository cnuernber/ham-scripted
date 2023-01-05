(ns ham-fisted.api
  (:require [ham-fisted.lazy-noncaching :refer [coll-reducer]:as lznc]
            [ham-fisted.BitmapTrie :as bm]
            [ham-fisted.ChunkedVec :as cv])
  (:refer-clojure :exclude [frequencies object-array range group-by]))


(declare make-immut)


;; (defn- reload-module
;;   [fpath]
;;   (js-delete (.-cache js/require) (.resolve js/require fpath))
;;   (js/require fpath))


;; (def bm-module (reload-module "./BitmapTrie.js"))
;; (def cv-module (reload-module "./ChunkedVec.js"))

(defn fhash
  "Faster hash method specifically for numbers - comparisons are reordered."
  [item]
  (cond
    (nil? item) 0
    (number? item)
    (bit-or 0 (Math/floor item))
    :else
    (hash item)))

(def raw-provider bm/defaultProvider)
(def default-hash-provider (js-obj "hash" fhash
                                   "equals" =
                                   "isReduced" reduced?
                                   "unreduce" #(if (reduced? %) (deref %) %)
                                   "print" println))

(def ^:private bm-cons bm/makeTrie)
(def ^:private ht-cons bm/makeHashTable)
(def ^:private mapProxy bm/mapProxy)
(def ^:private indexedAccum bm/indexedAccum)
(def ^:private cv-cons cv/makeChunkedVec)
(def ^:private sizeIfPossible bm/sizeIfPossible)
(def ^:private idxAcc cv/indexedAccum)
(def ^:private RangeType cv/Range)


(extend-type RangeType
  IReduce
  (-reduce
    ([r rfn] (bm/reduce1 default-hash-provider rfn r))
    ([r rfn acc] (.reduce r rfn acc))))

(defn range
  ([] (cljs.core/range))
  ([end] (cv/range 0 end 1 default-hash-provider))
  ([start end] (cv/range start end 1 default-hash-provider))
  ([start end step] (cv/range start end step default-hash-provider)))


(defn coll-reduce
  ([coll rfn] (bm/reduce1 default-hash-provider rfn (coll-reducer coll)))
  ([coll rfn init] (bm/reduce default-hash-provider rfn init (coll-reducer coll))))


(defn coll-transduce
  ([coll xform rfn]
   (coll-transduce coll xform rfn (rfn)))
  ([coll xform rfn init]
   (coll-reduce coll (xform rfn) init)))


(defn reduce-put!
  ([m data]
   (coll-reduce data #(do (.put ^JS %1 (nth %2 0) (nth %2 1)) %1) m))
  ([xform m data]
   (coll-transduce data xform (fn ([m] m) ([m d] (.put ^JS m (nth d 0) (nth d 1)) m)) m)))


(defn pairs
  ([rf] (fn
          ([m] (rf m))
          ([acc v] (rf acc (vector v v)))))
  ([r l] (vector r l)))


(defn mut-trie-map
  ([] (bm-cons default-hash-provider))
  ([data] (reduce-put! (bm-cons default-hash-provider) data))
  ([xform data] (reduce-put! xform (bm-cons default-hash-provider) data)))


(defn mut-hashtable-map
  ([] (ht-cons default-hash-provider))
  ([data] (reduce-put! (ht-cons default-hash-provider) data))
  ([xform data] (reduce-put! xform (ht-cons default-hash-provider) data)))


(defn mut-map
  ([] (mut-hashtable-map))
  ([data] (mut-hashtable-map data))
  ([xform data] (mut-hashtable-map xform data)))


(defn js-map
  ([] (js/Map.))
  ([data] (coll-reduce data (fn [m v] (.set m (nth v 0) (nth v 1))) (js/Map.)))
  ([xform data] (coll-transduce data xform (fn [m v] (.set m (nth v 0) (nth v 1))) (js/Map.))))


(def ^:private bm-type bm/BitmapTrie)
(def ^:private hm-type bm/HashTable)
(def ^:private cv-type cv/ChunkedVector)
(def ^:private empty-map (mut-map))


(deftype ImmutMap [^JS m]
  Object
  (toString [this] (.toString m))
  (size [this] (.size m))
  (reduce [this rfn init] (.reduce m rfn init))
  (keys [coll] (.keys m))
  (entries [coll] (.entries m))
  (values [coll] (.values m))
  (has [coll k] (.has m k))
  (get [coll k nf] (.getOrDefault m k nf))
  (forEach [coll f] (.forEach m f))
  ICounted
  (-count [this] (.size m))
   ICollection
   (-conj [coll o]
     (if (vector? o)
       (-assoc coll (-nth o 0) (-nth o 1))
       (-> (reduce (fn [^JS m o]
                     (if (vector? o)
                       (.put m (-nth o 0) (-nth o 1))
                       (throw (js/Error. "Invalid map conj data")))
                     m)
                   (.shallowClone m)
                   o)
           (make-immut))))
  IEmptyableCollection
  (-empty [coll] (make-immut empty-map))
  IEditableCollection
  (-as-transient [coll] (.shallowClone m))
  IEquiv
  (-equiv [this other] (equiv-map this other))
  IHash
  (-hash [this] (bm/cache_unordered hash this))
  ILookup
  (-lookup [o k] (.get m k))
  (-lookup [o k nf] (.getOrDefault m k nf))
  IAssociative
  (-contains-key? [coll k] (.containsKey m k))
  (-assoc [coll k v] (let [^JS m (.shallowClone m)]
                       (make-immut (.mutAssoc m k v))))
  IFind
  (-find [coll k] (.getNode m k))
  IMap
  (-dissoc [coll k]
   (let [^JS m (.shallowClone m)]
     (make-immut (.mutDissoc m k))))
  IFn
  (-invoke [this a] (.get m a))
  (-invoke [this a d] (.getOrDefault m a d))
  IReduce
  (-reduce [this rfn] (bm/reduce1 default-hash-provider rfn m))
  (-reduce [this rfn init] (bm/reduce default-hash-provider m rfn init))
  ISeqable
  (-seq [this] (seq m))
  IMeta
  (-meta [this] (.meta m))
  IWithMeta
  (-with-meta [this k] (make-immut (.withMeta m k)))
  IKVReduce
  (-kv-reduce [coll f init]
    (.reduceLeaves m #(f %1 (.-k ^JS %2) (.-v ^JS %2)) init))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer (.toString m))))


(defn- make-immut
  [^JS m]
  (set! (.-cache_hash m) true)
  (ImmutMap. m))


(defn extend-mut-map!
  [map-type]
  (extend-type map-type
    ITransientCollection
    (-conj! [this val]
      (.put this (nth val 0) (nth val 1))
      this)
    (-persistent! [this] (make-immut this))
    ITransientAssociative
    (-assoc! [tcoll key val]
      (.put tcoll key val) tcoll)
    IHash
    (-hash [this] (.hashCode this))
    IEquiv
    (-equiv [this other] (equiv-map this other))
    ICounted
    (-count [this] (.size this))
    IMeta
    (-meta [this] (.meta this))
    IWithMeta
    (-with-meta [this k] (.withMeta this k))
    ICloneable
    (-clone [this] (.clone this))
    ILookup
    (-lookup
      ([m k] (.get ^JS m k))
      ([m k nf] (.getOrDefault ^JS m k nf)))
    IFind
    (-find [m k] (.getNode ^JS m k))
    IMap
    (-dissoc [coll k] (throw (js/Error. "Unimplemented")))
    ISeqable
    (-seq [this] (es6-iterator-seq (lznc/js-iterator (.leaves this))))
    IFn
    (-invoke
      ([this a] (.get this a))
      ([this a d] (.getOrDefault this a d)))
    IReduce
    (-reduce
      ([this rfn] (bm/reduce1 default-hash-provider rfn this))
      ([this rfn init] (.reduce this rfn init)))
    IKVReduce
    (-kv-reduce [coll f init]
      (.reduceLeaves coll #(f %1 (.-k ^JS %2) (.-v ^JS %2)) init))
    IPrintWithWriter
    (-pr-writer [this writer opts]
      (-write writer (.toString this)))))


(def ^:private leaf-node-type bm/LeafNode)


(extend-type leaf-node-type
  ISequential
  ICounted
  (-count [this] 2)
  IHash
  (-hash [this] (.hashCode this))
  IEquiv
  (-equiv [this o]
    (if (== 2 (count o))
      (and (= (.-k this) (-nth o 0))
           (= (.-v this) (-nth o 1)))))
  IIndexed
  (-nth
    ([this idx] (case idx
                     0 (.-k this)
                     1 (.-v this)))
    ([this idx d] (if (and (number? idx) (>= idx 0) (< idx 2))
                    (case idx
                     0 (.-k this)
                     1 (.-v this))
                    d)))
  IReduce
  (-reduce
    ([this rfn] (rfn (.-k this) (.-v this)))
    ([this rfn acc] (.reduce this rfn acc)))
  IFn
  (-invoke
    ([this a] (-nth this a))
    ([this a d] (-nth this a d)))
  IMapEntry
  (-key [this] (.-k this))
  (-val [this] (.-v this))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer (.toString this))))


(extend-mut-map! bm-type)
(extend-mut-map! hm-type)


(defn immut-map
  ([] (make-immut (mut-hashtable-map)))
  ([data] (make-immut (mut-hashtable-map data)))
  ([xform data] (make-immut (mut-hashtable-map xform data))))


(extend-type cv-type
  ICounted
  (-count [this] (.size this))
  IReduce
  (-reduce
    ([this rfn] (bm/reduce1 default-hash-provider rfn this))
    ([this rfn init] (.reduce this rfn init))))


(defn freq-rf
  ([] (freq-rf nil))
  ([options]
   (let [mfn (get options :map-fn mut-hashtable-map)
         bifn (fn [k v] (if v (+ v 1) 1))]
     (fn
       ([] (mfn))
       ([m] (persistent! m))
       ([m v] (.compute ^JS m v bifn) m)))))


(defn frequencies
  ([data] (frequencies identity nil data))
  ([xform data] (frequencies xform nil data))
  ([xform options data]
   (coll-transduce data xform (freq-rf options))))


(defn indexed-acc-fn
  [rf]
  (idxAcc rf))


(defn object-array
  ([] (js/Array))
  ([data]
   (cond
     (nil? data)
     (js/Array)
     (number? data) (js/Array data)
     (.-toArray ^JS data)
     (.toArray ^JS data)
     :else
     (if-let [sz (sizeIfPossible data)]
       (coll-reduce data,
                    (indexed-acc-fn (fn [acc idx v] (aset acc idx v) acc))
                    (js/Array sz))
       (coll-reduce data
                    (indexed-acc-fn (fn [acc idx v] (.push acc v) acc))
                    (js/Array))))))

(defn mut-list
  ([] (cv-cons default-hash-provider))
  ([data] (doto (cv-cons default-hash-provider)
            (.addAll data)))
  ([xform data] (doto (cv-cons default-hash-provider)
                  (.addAll (coll-reducer (eduction xform data))))))


(defn group-by-reducer
  ([reducer coll] (group-by-reducer nil reducer nil coll))
  ([key-fn reducer coll] (group-by-reducer key-fn reducer nil coll))
  ([key-fn reducer options coll]
   (bm/groupByReduce default-hash-provider mut-hashtable-map key-fn reducer reducer
                     (if (get options :skip-finalize?) nil reducer)
                     (coll-reducer coll))))


(defn group-by
  [key-fn coll]
  (group-by-reducer key-fn (fn ([] (mut-list))
                             ([acc v] (.add ^JS acc v) acc)
                             ([acc] acc))
                    coll))


(defn ^:no-doc group-by-reducer-cljs
  "Useful for timing information"
  [key-fn reducer coll]
  (->> (cljs.core/group-by key-fn coll)
       (into {} (map (fn [[k v]] [k (-> (reduce reducer (reducer) v)
                                        (reducer))])))))


(defn reduce-reducer
  [reducer data]
  (-> (coll-reduce data reducer (reducer))
      (reducer)))


(defn consumer-reducer
  ([cons-fn]
   (fn
     ([] (cons-fn))
     ([acc v] (.accept ^JS acc v) acc)
     ([acc] (.deref acc))))
  ([cons-fn fin-fn]
   (fn
     ([] (cons-fn))
     ([acc v] (.accept ^JS acc v) acc)
     ([acc] (fin-fn (.deref acc))))))


(defn sum-n-elems
  "Return a map of :sum :n-elems from a sequence of numbers."
  [data]
  (let [^JS s (reduce-reducer (consumer-reducer cv/sum) data)]
    {:n-elems (.-n s)
     :sum (.-s s)}))


(def ^{:doc "Summation reducer"} sum-r (consumer-reducer cv/sum #(.-s ^JS %)))


(defn sum
  "Sum of a sequence of numbers."
  [data]
  (reduce-reducer sum-r data))


(def ^{:doc "Mean reducer"} mean-r (consumer-reducer cv/sum
                                                     #(/ (.-s ^JS %) (.-n ^JS %))))

(defn mean
  "Mean of a sequence of numbers."
  [data]
  (reduce-reducer mean-r data))

(defn mmax-key-r
  "Max key reducer"
  [key-fn] (consumer-reducer #(cv/mmax_key key-fn)))

(defn mmin-key-r
   "Min key reducer"
  [key-fn] (consumer-reducer #(cv/mmin_key key-fn)))


(defn mmax-key [key-fn data] (reduce-reducer (mmax-key-r key-fn) data))
(defn mmin-key [key-fn data] (reduce-reducer (mmin-key-r key-fn) data))
(defn- akey? [data] (when data (aget data 0)))
(defn- aval [data] (aget data 1))


(defn mode
  [data]
  ;;map entries in js-land are arrays or array-like
  (->> (frequencies data)
       (mmax-key aval)
       akey?))


(comment
  (dotimes [idx 10] (time (cljs.core/frequencies (eduction (map #(rem % 373373)) (range 1000000)))))
  ;;averages about 1220ms

  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-trie-map} (range 1000000))))
  ;;averages about 400ms
  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-hashtable-map} (range 1000000))))
  ;;averages about 80ms

  )
