(ns ham-fisted.protocols)



(defprotocol IUpdateValues
  (-update-values [this bifn]
    "Update every value in the collection to a new value.  If the collection
is mutable, do this mutably.  If it is immutable, do this as efficiently as
possible and return a new collection."))
