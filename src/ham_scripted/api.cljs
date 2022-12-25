(ns ham-scripted.api
  (:require [kixi.stats.core :as k])
  (:refer-clojure :exclude [frequencies object-array range]))


(defn- reload-module
  [fpath]
  (js-delete (.-cache js/require) (.resolve js/require fpath))
  (js/require fpath))


(def bm-module (reload-module "./BitmapTrie.js"))
(def cv-module (reload-module "./ChunkedVec.js"))

(defn fhash
  "Faster hash method specifically for numbers - comparisons are reordered."
  [item]
  (cond
    (nil? item) 0
    (number? item)
    (bit-or 0 (Math/floor item))
    :else
    (hash item)))

(def raw-provider (aget bm-module "defaultProvider"))

(def default-provider (js-obj "hash" fhash
                              "equals" =
                              "isReduced" reduced?
                              "unreduce" #(if (reduced? %) (deref %) %)
                              "print" println))

(def ^:private bm-cons (aget bm-module "makeTrie"))
(def ^:private ht-cons (aget bm-module "makeHashTable"))
(def ^:private mapProxy (aget bm-module "mapProxy"))
(def ^:private rot-left (aget bm-module "rotLeft"))
(def indexedAccum (aget cv-module "indexedAccum"))
(def ^:private cv-cons (aget cv-module "makeChunkedVec"))
(def ^:private sizeIfPossible (aget cv-module "sizeIfPossible"))
(def ^:private idxAcc (aget cv-module "indexedAccum"))


(defn range
  ([] (cljs.core/range))
  ([end] (.range cv-module 0 end 1 default-provider))
  ([start end] (.range cv-module start end 1 default-provider))
  ([start end step] (.range cv-module start end step default-provider)))


(defn coll-reducer
  [coll]
  (cond
    (nil? coll) coll
    (array? coll) coll
    (nil? (.-reduce coll))
    (if-let [l (sizeIfPossible coll)]
      (js-obj "length" l "reduce" #(-reduce coll %1 %2))
      (js-obj "reduce" #(-reduce coll %1 %2)))
    :else coll))


(defn coll-reduce
  [coll rfn init]
  (.reduce bm-module rfn init (coll-reducer coll)))


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


(defn mut-map
  ([] (bm-cons default-provider))
  ([data] (reduce-put! (bm-cons default-provider) data))
  ([xform data] (reduce-put! xform (bm-cons default-provider) data)))


(defn java-hashmap
  ([] (ht-cons default-provider))
  ([data] (reduce-put! (ht-cons default-provider) data))
  ([xform data] (reduce-put! xform (ht-cons default-provider) data)))



(defn freq-rf
  ([] (freq-rf nil))
  ([options]
   (let [mfn (get options :map-fn java-hashmap)
         bifn (fn [k v] (if v (+ v 1) 1))]
     (fn
       ([] (mfn))
       ([m] m)
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
  ([] (cv-cons default-provider))
  ([data] (doto (cv-cons default-provider)
            (.addAll data))))


(def ^:private mm-type (type (mut-map)))
(def ^:private jm-type (type (java-hashmap)))
(def ^:private ml-type (type (mut-list)))


;; These break hot-reload - probably because the typenames are the same

;; (extend-type mm-type
;;   IReduce
;;   (-reduce [this rfn init] (.reduce this rfn init)))

;; (extend-type jm-type
;;   IReduce
;;   (-reduce [this rfn init] (.reduce this rfn init)))

;; (extend-type ml-type
;;   IReduce
;;   (-reduce [this rfn init] (.reduce this rfn init)))


(defn group-by-reducer
  ([reducer coll] (group-by-reducer nil reducer nil coll))
  ([key-fn reducer coll] (group-by-reducer key-fn reducer nil coll))
  ([key-fn reducer options coll]
   (. bm-module groupByReduce java-hashmap key-fn reducer reducer
      (if (get options :skip-finalize?) nil reducer)
      (coll-reducer coll))))


(defn group-by-reducer-cljs
  [key-fn reducer coll]
  (->> (group-by key-fn coll)
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
  (let [^JS s (reduce-reducer (consumer-reducer (.-sum cv-module)) data)]
    {:n-elems (.-n s)
     :sum (.-s s)}))


(def ^{:doc "Summation reducer"} sum-r (consumer-reducer (.-sum cv-module) #(.-s ^JS %)))


(defn sum
  "Sum of a sequence of numbers."
  [data]
  (reduce-reducer sum-r data))


(def ^{:doc "Mean reducer"} mean-r (consumer-reducer (.-sum cv-module)
                                                     #(/ (.-s ^JS %) (.-n ^JS %))))

(defn mean
  "Mean of a sequence of numbers."
  [data]
  (reduce-reducer mean-r data))

(defn mmax-key-r
  "Max key reducer"
  [key-fn] (consumer-reducer #(.mmax_key cv-module key-fn)))

(defn mmin-key-r
   "Min key reducer"
  [key-fn] (consumer-reducer #(.mmin_key cv-module key-fn)))


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

  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-map} (range 1000000))))
  ;;averages about 400ms
  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn java-hashmap} (range 1000000))))
  ;;averages about 125ms

  )
