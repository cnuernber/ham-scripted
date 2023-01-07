(ns ham-fisted.api-test
  (:require [ham-fisted.api :as hamf]
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
