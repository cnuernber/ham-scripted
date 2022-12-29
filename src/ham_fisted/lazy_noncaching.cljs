(ns ham-fisted.lazy-noncaching
  (:refer-clojure :exclude [map counted? count filter concat remove]))


(defn- reload-module
  [fpath]
  (js-delete (.-cache js/require) (.resolve js/require fpath))
  (js/require fpath))


(def bm-module (reload-module "./BitmapTrie.js"))


(defn js-iterator
  [obj]
  (if-let [iter-fn (aget obj (.-iterator js/Symbol))]
    (.call iter-fn obj)
    (let [i (iter obj)]
      (js-obj "next" (fn []
                       (if (.hasNext i)
                         (js-obj "done" false "value" (.next i))
                         (js-obj "done" true)))))))


(defn counted?
  [m]
  (or (.-length m) (.-size m) (cljs.core/counted? m)))


(defn count
  [m]
  (if (nil? m)
    0
    (if-let [l (.-length m)]
      l
      (if-let [l (.-size m)]
        (if (fn? l) (.size m) l)
        (cljs.core/count m)))))


(defn coll-reducer
  [coll]
  (cond
    (nil? coll) coll
    (array? coll) coll
    (and (nil? (.-reduce coll)) (satisfies? IReduce coll))
    (let [rv (js-obj "reduce" #(-reduce coll %1 %2)
                     (.-iterator js/Symbol) #(js-iterator coll))]
      (if-let [l (when (counted? coll) (count coll))]
        (do (aset rv "length" l) rv)
        rv))
    :else coll))

(def reducedProvider (js-obj "isReduced" reduced?
                             "unreduce" #(if (reduced? %) (deref %) %)
                             "makeReduced" reduced
                             "print" println))


(defn map
  ([f] (cljs.core/map f))
  ([f arg] (if (nil? arg) '() (.lznc_map_1 bm-module reducedProvider f (coll-reducer arg))))
  ([f lhs rhs] (.lznc_map_2 bm-module reducedProvider f (coll-reducer lhs) (coll-reducer rhs)))
  ([f lhs rhs & args]
   (let [arg (js/Array)]
     (.push arg lhs)
     (.push arg rhs)
     (reduce (fn [acc v] (.push acc v) acc) arg args)
     (.lznc_map_n bm-module reducedProvider f arg))))


(defn filter
  ([f] (cljs.core/filter f))
  ([f arg] (if (nil? arg) '() (.lznc_filter bm-module reducedProvider f arg))))


(defn remove
  ([f] (filter (complement f)))
  ([f arg] (filter (complement f) arg)))


(defn concat
  ([] '())
  ([& args]
   (if-not (seq (rest args))
     (first args)
     (.lznc_concat bm-module reducedProvider (map coll-reducer args)))))
