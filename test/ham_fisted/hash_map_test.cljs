(ns ham-fisted.hash-map-test
  (:require [ham-fisted.api :as hamf]
            [clojure.set :as set]
            [clojure.test :refer [deftest is are testing]]))


(def orig hamf/empty-map)


(deftest simple-assoc
  (let [orig hamf/empty-map]
    (is (= 0 (count orig)))
    (is (= {:a :b} (assoc orig :a :b)))
    (is (= 1 (count (assoc orig :a :b))))
    (is (= {} (-> (assoc orig :a :b)
                  (dissoc :a))))
    (is (= 0 (-> (assoc orig :a :b)
                 (dissoc :a)
                 (count)))))

  (let [nilmap (assoc orig nil :b)]
    (is (= {nil :b} nilmap))
    (is (= nilmap {nil :b}))
    (is (= {nil :b :a :b} (assoc nilmap :a :b)))
    (is (= (assoc nilmap :a :b) {nil :b :a :b}))
    (is (= 1 (count nilmap)))
    (is (= 1 (count (dissoc nilmap :a))))
    (is (= 2 (count (assoc nilmap :a :b))))
    (is (= 0 (count (dissoc nilmap nil))))
    (is (= #{nil :a} (set (keys (assoc nilmap :a :b)))))))


(defonce test-data* (atom nil))


(deftest random-assoc-dissoc
  (let [n-elems 100
        n-take (quot n-elems 10)
        n-left (- n-elems n-take)
        data (shuffle (range n-elems))
        dissoc-vals (take n-take data)
        data (set data)
        dissoc-data (set/difference data (set dissoc-vals))]
    (reset! test-data* {:data data
                        :dissoc-vals dissoc-vals
                        :dissoc-data dissoc-data})
    (testing "immutable"
      (let [alldata (reduce #(assoc %1 %2 %2)
                            orig
                            data)
            disdata (reduce #(dissoc %1 %2) alldata dissoc-vals)]
        (is (= n-left (count disdata)))
        (is (= n-elems (count alldata)))
        (is (= dissoc-data (set (keys disdata))))
        (is (= data (set (keys alldata))))))
    (testing "hash table mutable"
      (let [alldata (hamf/mut-hashtable-map (map #(vector % %)) data)
            disdata (.clone alldata)
            _ (is (= n-elems (count disdata)))
            _ (reduce #(do (.remove ^JS %1 %2) %1) disdata dissoc-vals)]
        (is (= n-left (count disdata)))
        (is (= n-elems (count alldata)))
        (is (= dissoc-data (set (keys disdata))))
        (is (= data (set (keys alldata))))
        ))
    (testing "bitmap trie mutable"
      (let [alldata (hamf/mut-trie-map (map #(vector % %)) data)
            disdata (.clone alldata)
            _ (is (= n-elems (count disdata)))
            _ (reduce #(do (.remove ^JS %1 %2) %1) disdata dissoc-vals)]
        (is (= n-left (count disdata)))
        (is (= n-elems (count alldata)))
        (is (= dissoc-data (set (keys disdata))))
        (is (= data (set (keys alldata))))
        ))))
