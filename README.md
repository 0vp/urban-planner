Root Issue: 24-bit Picking ID Collision

   The problem occurs because of how deck.gl's picking system works:

   1. Picking uses 24-bit color encoding: When you click on a building, deck.gl
      encodes the object index into RGB colors (8 bits per channel = 24 bits
      total). This means only values 0 to 16,777,215 (2^24 - 1) can be uniquely
      represented.

   2. Feature IDs are 32-bit integers: The I3S dataset uses feature IDs like
      -1370585984 and 23010244. These are 32-bit signed integers.

   3. Truncation happens in picking: When deck.gl renders for picking, it
      truncates the feature ID to 24 bits using the formula ((fid + 1) & 0xFFFFFF)
       - 1. This causes collisions when:
     •  Two feature IDs differ only in bits 25-32
     •  Or for negative numbers, when they map to the same 24-bit value

   4. Multiple buildings share the same truncated ID: When you click building A
      with ID -1370585984, the picking system returns a truncated value. But
      buildings B, C, D in other tiles might have different full IDs that truncate
       to the same 24-bit value.

   5. highlightedObjectIndex uses the truncated value: The original code stored
      info.index (the truncated picking index) in selectedI3sPickIndex and passed
      it to highlightedObjectIndex. This caused ALL buildings with that truncated
      ID to highlight across ALL tiles.
   
find a way to resolve this in a robust way. consider if multiple bulidings with same id is in the same tile. and many other edge cases. this is a problem because if we select 1 bulidng to delete, if there are matching id buldings, then those also get deleted.