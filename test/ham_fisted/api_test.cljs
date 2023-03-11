(ns ham-fisted.api-test
  (:require [ham-fisted.api :as hamf]
            [ham-fisted.lazy-noncaching :as lznc]
            [clojure.test :refer [deftest is]]))



(deftest update-values-test
  (is (= 90 (reduce + 0 (-> (hamf/mut-map (map #(vector % %)) (hamf/range 10))
                            (hamf/update-values +)
                            vals))))
  (is (= 90 (reduce + 0 (-> (hamf/immut-map (map #(vector % %)) (hamf/range 10))
                            (hamf/update-values +)
                            vals))))
  (is (= 90 (reduce + 0 (-> (into {} (map #(vector % %)) (hamf/range 10))
                            (hamf/update-values +)
                            vals)))))

(deftest range-is-integer
  (is (.isInteger ^JS (hamf/range 10)))
  (is (not (.isInteger ^JS (hamf/range 0.5 10.5 0.5)))))


(deftest invokers-work
  (= [1 2] (vec (lznc/map {:a 1 :b 2} [:a :b]))))


(deftest immut-list-reduce
  (is (= 55 (reduce + (hamf/mapv inc (range 10))))))
