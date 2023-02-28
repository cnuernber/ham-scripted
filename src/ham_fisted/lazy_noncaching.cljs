(ns ham-fisted.lazy-noncaching
  (:require [ham-fisted.BitmapTrie :as bm])
  (:refer-clojure :exclude [map counted? count filter concat remove]))


(defn fhash
  "Faster hash method specifically for numbers - comparisons are reordered."
  [item]
  (cond
    (nil? item) 0
    (number? item)
    (bit-or 0 (Math/floor item))
    :else
    (hash item)))


(def default-hash-provider (bm/makeHashProvider
                            fhash =
                            reduced? #(if (reduced? %) (deref %) %)
                            #(if (reduced? %) (deref %) %)
                            reduced
                            println))


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


(defn map
  ([f] (cljs.core/map f))
  ([f arg] (if (nil? arg) '() (bm/lznc_map_1 default-hash-provider f (coll-reducer arg))))
  ([f lhs rhs] (bm/lznc_map_2 default-hash-provider f (coll-reducer lhs) (coll-reducer rhs)))
  ([f lhs rhs & args]
   (let [arg (js/Array)]
     (.push arg (coll-reducer lhs))
     (.push arg (coll-reducer rhs))
     (reduce (fn [acc v] (.push acc (coll-reducer v)) acc) arg args)
     (bm/lznc_map_n default-hash-provider f arg))))


(defn filter
  ([f] (cljs.core/filter f))
  ([f arg] (if (nil? arg) '() (bm/lznc_filter default-hash-provider f (coll-reducer arg)))))


(defn remove
  ([f] (filter (complement f)))
  ([f arg] (filter (complement f) arg)))


(defn concat
  ([] '())
  ([& args]
   (if-not (seq (rest args))
     (first args)
     (bm/lznc_concat default-hash-provider (map coll-reducer args)))))


(defn- iter-seq->string
  [opts iter]
  (str
   (reduce (fn [acc v]
             (cond
               (> (.-length acc) 1024) (reduced (str acc " ..."))
               (> (.-length acc) 1) (str acc " " v)
               :else
               (str acc v)))
           "("
           iter)
   ")"))


(defn extend-seq-type
  [t]
  (extend-type t
    IPrintWithWriter
    (-pr-writer [this writer opts]
      (-write writer (iter-seq->string opts this)))
    IReduce
    (-reduce
      ([this rfn] (bm/reduce1 (.-hp this) rfn this))
      ([this rfn init] (.reduce this rfn init)))))



(extend-seq-type bm/Map1Impl)
(extend-seq-type bm/Map2Impl)
(extend-seq-type bm/MapNImpl)
(extend-seq-type bm/FilterImpl)
(extend-seq-type bm/ConcatImpl)
