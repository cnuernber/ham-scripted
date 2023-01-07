(ns ham-fisted.chunked-vec-test
  (:require [ham-fisted.api :as hamf]
            [ham-fisted.lazy-noncaching :as lznc]
            [clojure.test :refer [deftest is are]]))



(defn =vec
  [expected v] (and (vector? v) (= expected v)))


(deftest test-mapv
  (are [r c1] (=vec r (hamf/mapv + c1))
    [1 2 3] [1 2 3])
  (are [r c1 c2] (=vec r (hamf/mapv + c1 c2))
    [2 3 4] [1 2 3] (repeat 1))
  (are [r c1 c2 c3] (=vec r (hamf/mapv + c1 c2 c3))
    [3 4 5] [1 2 3] (repeat 1) (repeat 1))
  (are [r c1 c2 c3 c4] (=vec r (hamf/mapv + c1 c2 c3 c4))
    [4 5 6] [1 2 3] [1 1 1] [1 1 1] [1 1 1]))
