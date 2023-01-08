(ns ham-fisted.api
  (:require [ham-fisted.lazy-noncaching :refer [coll-reducer]:as lznc]
            [ham-fisted.BitmapTrie :as bm]
            [ham-fisted.ChunkedVec :as cv]
            [ham-fisted.protocols :as hamf-proto])
  (:refer-clojure :exclude [frequencies object-array range group-by mapv]))


(declare make-immut make-immut-list empty-map range constant-count)


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
(def RangeType cv/Range)


(extend-type RangeType
  IHash
  (-hash [this] (.hashCode this))
  IEquiv
  (-equiv [this o]
    (if (and (satisfies? ICounted o) (== (count this) (count o)))
      (reduce (idxAcc (fn [acc idx v]
                        (if (= (.get this idx)
                               (-nth o idx))
                          true
                          (reduced false))))
              true
              this)
      false))
  IIndexed
  (-nth
    ([this idx] (-nth this idx nil))
    ([this idx dv]
     (let [idx
           (if (< idx 0)
             (+ idx (.-length this))
             idx)]
       (if (and (>= idx 0) (< idx (.-length this)))
         (.get this idx)
         dv))))
  IFn
  (-invoke
    ([this idx] (-nth this idx))
    ([this idx dv] (-nth this idx dv)))
  ICounted
  (-count [this] (.-length this))
  IReduce
  (-reduce
    ([r rfn] (bm/reduce1 default-hash-provider rfn r))
    ([r rfn acc] (.reduce r rfn acc)))
  IMeta
  (-meta [this] (.-meta this))
  IWithMeta
  (-with-meta [this m]
    (let [r (range (.-start this) (.-end this) (.-step this))]
      (aset r "meta" m)
      r))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer "[")
    (.reduce this (fn [acc v] (when-not acc (-write writer " "))
              (-write writer v)
              false)
             true)
    (-write writer "]")))

(defn range
  ([] (cljs.core/range))
  ([end] (cv/range 0 end 1 default-hash-provider))
  ([start end] (cv/range start end 1 default-hash-provider))
  ([start end step] (cv/range start end step default-hash-provider)))


(defn coll-reduce
  ([coll rfn] (bm/reduce1 default-hash-provider rfn (coll-reducer coll)))
  ([coll rfn init] (bm/reduce default-hash-provider rfn init (coll-reducer coll))))


(defn constant-count
  "Constant time count.  Returns nil if input doesn't have a constant time count."
  [data]
  (if (nil? data)
    0
    (if-let [sz (sizeIfPossible data)]
      sz
      (when (satisfies? ICounted data)
        (count data)))))


(defn coll-transduce
  ([coll xform rfn]
   (coll-transduce coll xform rfn (rfn)))
  ([coll xform rfn init]
   (coll-reduce coll (xform rfn) init)))


(defn hash-ordered
  "Calculate the hashcode of an ordered container"
  [coll]
  (bm/hash_ordered hash (coll-reducer coll)))


(defn hash-unordered
  "Calculate the hashcode of an unordered container"
  [coll]
  (bm/hash_unordered hash (coll-reducer coll)))


(defn cache-ordered
  "Cache and return the hashcode of an ordered container"
  [coll]
  (if-let [h (aget coll "_hash")]
    h
    (do
      (let [rv (hash-ordered coll)]
        (aset coll "_hash" rv)
        rv))))


(defn cache-unordered
  [coll]
  (if-let [h (aget coll "_hash")]
    h
    (do
      (let [rv (hash-unordered coll)]
        (aset coll "_hash" rv)
        rv))))


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

(defn- safe-write
  [obj writer opts]
  (if (satisfies? IPrintWithWriter obj)
    (-pr-writer obj writer opts)
    (-write writer (if (nil? obj) "nil" obj))))

(deftype ImmutMap [m]
  Object
  (toString [this] (.toString ^JS m))
  (size [this] (.size ^JS m))
  (reduce [this rfn init] (.reduce ^JS m rfn init))
  (keys [coll] (.keys ^JS m))
  (entries [coll] (.entries ^JS m))
  (values [coll] (.values ^JS m))
  (has [coll k] (.has ^JS m k))
  (get [coll k nf] (.getOrDefault ^JS m k nf))
  (forEach [coll f] (.forEach ^JS m f))
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
                  (.shallowClone ^JS m)
                  o)
          (make-immut))))
  IEmptyableCollection
  (-empty [coll] empty-map)
  IEditableCollection
  (-as-transient [coll] (.shallowClone ^JS m))
  IEquiv
  (-equiv [this other] (equiv-map this other))
  IHash
  (-hash [this] (bm/cache_unordered hash this))
  ILookup
  (-lookup [o k] (.get ^JS m k))
  (-lookup [o k nf] (.getOrDefault ^JS m k nf))
  IAssociative
  (-contains-key? [coll k] (.containsKey ^JS m k))
  (-assoc [coll k v] (let [^JS m (.shallowClone ^JS m)]
                       (make-immut (.mutAssoc ^JS m k v))))
  IFind
  (-find [coll k] (.getNode ^JS m k))
  IMap
  (-dissoc [coll k]
   (let [^JS m (.shallowClone ^JS m)]
     (make-immut (.mutDissoc m k))))
  IFn
  (-invoke [this a] (.get ^JS m a))
  (-invoke [this a d] (.getOrDefault ^JS m a d))
  IReduce
  (-reduce [this rfn] (bm/reduce1 default-hash-provider rfn m))
  (-reduce [this rfn init] (bm/reduce default-hash-provider m rfn init))
  ISeqable
  (-seq [this] (seq m))
  IMeta
  (-meta [this] (.meta ^JS m))
  IWithMeta
  (-with-meta [this k] (make-immut (.withMeta ^JS m k)))
  IKVReduce
  (-kv-reduce [coll f init]
    (let [kk (do m)] (-kv-reduce kk f init)))
  hamf-proto/IUpdateValues
  (-update-values [this bifn]
    (let [rv (.shallowClone ^JS m)]
      (.mutUpdateValues ^JS rv bifn)
      (persistent! rv)))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-pr-writer m writer opts)))



(defn- make-immut
  [^JS m]
  (set! (.-cache_hash m) true)
  (ImmutMap. m))


(def empty-map (make-immut (mut-map)))


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
    hamf-proto/IUpdateValues
    (-update-values [this bifn]
      (.mutUpdateValues ^JS this bifn))
    IPrintWithWriter
    (-pr-writer [this writer opts]
      (-write writer "{")
      (.reduceLeaves this (fn [acc v]
                            (when-not acc
                              (-write writer ","))
                            (safe-write (.-k ^JS v) writer opts)
                            (-write writer " ")
                            (safe-write (.-v ^JS v) writer opts)
                            false)
                     true)
      (-write writer "}"))))


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


(defn update-values
  [m bifn]
  (if (satisfies? hamf-proto/IUpdateValues m)
    (hamf-proto/-update-values m bifn)
    (immut-map (map (fn [e]
                      [(key e) (bifn (key e) (val e))]))
               m)))


(extend-type cv-type
  IHash
  (-hash [this] (.hashCode this))
  IEquiv
  (-equiv [this o]
    (if (== (count this) (count o))
      (reduce (idxAcc (fn [acc idx v]
                        (if (= (.get this idx)
                               (-nth o idx))
                          true
                          (reduced false))))
              true
              this)
      false))
  ISequential
  IIndexed
  (-nth
    ([this idx]
     (let [l (.-length this)
           idx (if (< idx 0)
                 (+ idx l)
                 idx)]
       (when (and (>= idx 0) (< idx l)) (.get this idx))))
    ([this idx dv]
     (let [l (.-length this)
           idx (if (< idx 0)
                 (+ idx l)
                 idx)]
       (if (and (>= idx 0) (< idx l)) (.get this idx) dv))))
  IFn
  (-invoke
    ([this idx] (-nth this idx))
    ([this idx dv] (-nth this idx dv)))
  ITransientCollection
  (-conj! [this val]
    (.mutAssoc this (.size this) val)
    this)
  (-persistent! [this] (make-immut-list this))

  ITransientAssociative
  (-assoc! [tcoll key val]
    (if (number? key)
      (-assoc-n! tcoll key val)
      (throw (js/Error. "TransientVector's key for assoc! must be a number."))))

  ITransientVector
  (-assoc-n! [tcoll n val] (.mutAssoc ^JS tcoll n val))
  (-pop! [tcoll] (.mutPop ^JS tcoll))
  ILookup
  (-lookup
    ([coll k] (-lookup coll k nil))
    ([coll k not-found]
     (if (number? k)
       (-nth coll k not-found)
       not-found)))
  ICounted
  (-count [this] (.-length this))
  IReduce
  (-reduce
    ([this rfn] (bm/reduce1 default-hash-provider rfn this))
    ([this rfn init] (.reduce this rfn init)))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer "[")
    (.reduce this (fn [acc v]
                    (when-not acc (-write writer " "))
                    (safe-write v writer opts)
                    false)
             true)
    (-write writer "]")))


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


(defn indexed-accum-fn
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
     (if-let [sz (constant-count data)]
       (coll-reduce data,
                    (indexed-accum-fn (fn [acc idx v] (aset acc idx v) acc))
                    (js/Array sz))
       (coll-reduce data
                    (indexed-accum-fn (fn [acc idx v] (.push acc v) acc))
                    (js/Array))))))

(defn mut-list
  ([] (cv-cons default-hash-provider))
  ([data] (doto (cv-cons default-hash-provider)
            (.addAll data)))
  ([xform data] (doto (cv-cons default-hash-provider)
                  (.addAll (coll-reducer (eduction xform data))))))

(deftype ImmutList [l]
  Object
  (size [this] (.size ^JS l))
  (toArray [this] (.toArray ^JS l))
  (reduce [this rfn init] (.reduce ^JS l rfn init))
  (toString [this] (.toString ^JS l))
  IEquiv
  (-equiv [this o] (-equiv l o))
  IHash
  (-hash [this] (bm/cache_ordered hash this))
  ICounted
  (-count [this] (.size l))
  IAssociative
  (-contains-key? [coll k] (and (number? k) (>= k 0) (< k (.size l))))
  (-assoc [coll k v]
    (if (number? k)
      (let [^JS l (.shallowClone ^JS l)]
        (-> (.mutAssoc ^JS l k v)
            (make-immut-list)))
      (throw (js/Error. "Assoc'ed keys must be numbers"))))
  IVector
  (-assoc-n [coll k v] (-assoc coll k v))
  ISequential
  IIndexed
  (-nth [this idx]
    (let [len (.-length ^JS l)
          idx (if (< idx 0)
                (+ idx len)
                idx)]
      (when (and (>= idx 0) (< idx len))
        (.get ^JS l idx))))
  (-nth [this idx dv]
   (let [len (.-length ^JS l)
         idx (if (< idx 0)
               (+ idx len)
               idx)]
     (if (and (>= idx 0) (< idx len))
       (.get ^JS l idx)
       dv)))
  IFn
  (-invoke [this idx] (-nth this idx))
  (-invoke [this idx dv] (-nth this idx dv))
  ICollection
  (-conj [coll o]
    (-assoc coll (.-length ^JS l) o))
  ISeqable
  (-seq [this] (seq ^JS l))
  IMeta
  (-meta [this] (.-meta ^JS l))
  IWithMeta
  (-with-meta [this k] (make-immut-list (.withMeta ^JS l k)))
  IKVReduce
  (-kv-reduce [coll f init] (-kv-reduce l f init))
  IStack
  (-peek [this]
    (let [len (.-length ^JS l)]
      (when (> len 0) (.get ^JS l (dec len)))))
  (-pop [this]
    (let [ll (.shallowClone ^JS l)]
      (make-immut-list (.mutPop ^JS ll))))
  IEmptyableCollection
  (-empty [coll]
    (let [rv (mut-list)]
      (make-immut-list (.withMeta ^JS rv (.-meta ^JS l)))))
  IEditableCollection
  (-as-transient [this]
    (.shallowClone ^JS l))
  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer l)))


(aset (.-prototype ImmutList) ITER_SYMBOL
      (fn []
        (this-as this
          (let [subl (.-l ^JS this)]
            (.call (aget subl ITER_SYMBOL) subl)))))


(defn- make-immut-list
  [l]
  (ImmutList. l))


(defn immut-list
  ([] (make-immut-list (mut-list)))
  ([data] (make-immut-list (mut-list data)))
  ([xform data] (make-immut-list (mut-list xform data))))


(defn mapv
  ([map-fn arg]
   (persistent! (mut-list (lznc/map map-fn) arg)))
  ([map-fn arg1 arg2]
   (persistent! (mut-list (lznc/map map-fn arg1 arg2))))
  ([map-fn arg1 arg2 & args]
   (persistent! (mut-list (apply lznc/map map-fn arg1 arg2 args)))))


(defn concatv
  [& args]
  (->
   (reduce (fn [rv v]
             (when v
               (.addAll ^JS rv (coll-reducer v)))
             rv)
           (mut-list)
           args)
   (persistent!)))


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


(defn is-nan?
  "Generalized is nan - returns true for nil - booleans are considered numbers"
  [data]
  (or (not (or (boolean? data) (number? data))) (js/isNaN data)))


(defn is-not-nan?
  "Generalized is not nan - returns false for nil - booleans are considered numbers"
  [data]
  (and (or (boolean? data) (number? data)) (not (js/isNaN data))))


(defn apply-nan-strategy
  [options data]
  (case (get options :nan-strategy :remove)
    :remove (lznc/filter is-not-nan? data)
    :exception (lznc/map #(if (is-nan? %)
                            (throw (js/Error. "Nan Detected"))
                            %)
                         data)
    :keep data))

(defn sum-n-elems
  "Return a map of :sum :n-elems from a sequence of numbers."
  ([options data]
   (let [^JS s (reduce-reducer (consumer-reducer cv/sum) (apply-nan-strategy options data))]
     {:n-elems (.-n s)
      :sum (.-s s)}))
  ([data] (sum-n-elems nil data)))


(def ^{:doc "Summation reducer"} sum-r (consumer-reducer cv/sum #(.-s ^JS %)))


(defn sum
  "Sum of a sequence of numbers."
  ([data] (sum nil data))
  ([options data] (reduce-reducer sum-r (apply-nan-strategy options data))))


(def ^{:doc "Mean reducer"} mean-r (consumer-reducer cv/sum
                                                     #(/ (.-s ^JS %) (.-n ^JS %))))

(defn mean
  "Mean of a sequence of numbers."
  ([options data] (reduce-reducer mean-r (apply-nan-strategy options data)))
  ([data] (mean nil data)))


(deftype VarReducer [^:unsynchronized-mutable c
                     ^:unsynchronized-mutable m
                     ^:unsynchronized-mutable ss]
  Object
  (accept [this e]
    (let [c' (inc c)
          m' (+ m (/ (- e m) c'))
          ss' (+ ss (* (- e m') (- e m)))]
      (set! c c')
      (set! m m')
      (set! ss ss')))
  (deref [this]
    (cond
      (== c 0) js/NaN
      (== c 1) 0
      :else
      (/ ss (dec c)))))


(def ^{:dec "Variance Reducer"} var-r (consumer-reducer #(VarReducer. 0 0 0)))


(defn variance
  ([options data]
   (reduce-reducer var-r (apply-nan-strategy options data)))
  ([data] (variance nil data)))


(defn standard-deviation
  ([options data] (Math/sqrt (variance options data)))
  ([data] (standard-deviation nil data)))


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
