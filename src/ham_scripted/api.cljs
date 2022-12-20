(ns ham-scripted.api
  (:refer-clojure :exclude [frequencies]))


(defn- reload-module
  [fpath]
  (js-delete (.-cache js/require) (.resolve js/require fpath))
  (js/require fpath))


(def bm-module (reload-module "./BitmapTrie.js"))

(defn fhash
  "Faster hash method specifically for numbers - comparisons are reordered."
  [item]
  (cond
    (nil? item) 0
    (number? item)
    (bit-or 0 (Math/floor item))
    :else
    (hash item)))

(def default-provider (js-obj "hash" fhash
                              "equals" =
                              "isReduced" reduced?
                              "unreduce" #(if (reduced? %) (deref %) %)
                              "print" println))

(def ^:private bm-cons (aget bm-module "makeTrie"))
(def ^:private ht-cons (aget bm-module "makeHashTable"))

(defn reduce-put!
  ([m data]
   (reduce #(do (.put ^JS %1 (nth %2 0) (nth %2 1)) %1) m data))
  ([xform m data]
   (transduce xform (fn ([m] m) ([m d] (.put ^JS m (nth d 0) (nth d 1)) m)) m data)))

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
   (let [mfn (get options :map-fn mut-map)
         bifn (fn [k v] (if v (+ v 1) 1))]
     (fn
       ([] (mfn))
       ([m] m)
       ([m v] (.compute ^JS m v bifn) m)))))


(defn frequencies
  ([data] (frequencies identity nil data))
  ([xform data] (frequencies xform nil data))
  ([xform options data]
   (transduce xform (freq-rf options) data)))


(comment
  (dotimes [idx 10] (time (cljs.core/frequencies (eduction (map #(rem % 373373)) (range 1000000)))))
  ;;averages about 1250ms

  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-map} (range 1000000))))
  ;;averages about 420ms
  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-map} (range 1000000))))
  ;;averages about 130ms

  )
