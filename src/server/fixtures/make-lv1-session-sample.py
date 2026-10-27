# Builds a small made-up LV1 session for the Patch plugin's tests: LV1 17.6's
# own table layouts (copied from a real session's schema, no data), with
# fictional devices and names. Small pages, many rows and one long name, so
# the reader's interior pages and overflow pages are exercised.
import sqlite3, sys, os
src, out = sys.argv[1], sys.argv[2]
schema = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
if os.path.exists(out): os.remove(out)
db = sqlite3.connect(out)
db.execute('pragma page_size=512')
for (sql,) in schema.execute("select sql from sqlite_master where type='table' and name in ('device','device_name','routes','object','snapshot_chainer','snapshot_iom','iom_chunks')"):
    db.execute(sql)
dev = lambda i, g, mac, bank, assign, desc, ins, outs: db.execute('insert into device (id,device_gender,mac,io_bank,assign,version,description,in_channel_count,out_channel_count,max_in_channel_count,max_out_channel_count,owner_uuid,ownership_level,is_share_preamp) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (i, g, mac, bank, assign, '1', desc, ins, outs, ins, outs, '', 0, 0))
dev(1, 0, 0x001cd1000001, 0, 1, 'IONIC 24', 26, 26)
dev(2, 0, 0x001cd1000002, 0, 2, 'IONIC 16', 18, 18)
dev(3, 0, 0x001cd1000003, 0, 0, 'Classic', 18, 18)
dev(6, 0, 0x001cd1000006, 0, 3, 'MGO', 64, 64)    # a MADI interface: no drawing of its own
dev(4, 1, 0x00309300aaaa, 0, 4, '', 32, 32)   # a computer (DAW): not a stage box
dev(5, 3, 0x50a4d0000001, -1, 0, 'SGS', -1, -1)
for mac, g, name in [(0x001cd1000001, 0, 'STAGE LEFT'), (0x001cd1000002, 0, 'DRUM RISER'), (0x001cd1000003, 0, 'Classic IO'), (0x001cd1000006, 0, 'MADI'), (0x00309300aaaa, 1, 'PLAYBACK')]:
    db.execute('insert into device_name values (?,?,?,?)', (mac, g, f'{mac:x}#{g}', name))
names = {(0, 0): 'KICK', (0, 1): 'OVERHEADS', (0, 2): 'VOX 1', (0, 3): 'LEAD VOCAL ' + 'X' * 600, (0, 4): 'PLAYBACK ST', (0, 5): 'TB A', (0, 6): 'TB B',
         (2, 0): 'AUX A', (2, 1): 'AUX B', (25, 0): 'MON A', (25, 1): 'MON B', (25, 2): 'MON C', (3, 0): 'LR', (8, 0): 'FOH TB'}
oid = 0
for (t, i), n in names.items():
    oid += 1
    db.execute('insert into object (id,obj_type,obj_index,name) values (?,?,?,?)', (oid, t, i, None))
    db.execute('insert into snapshot_chainer (chainer_id,snapshot_id,name) values (?,?,?)', (oid, -1, n))
    for snap in range(1, 31):  # older scenes' names: not the current ones
        db.execute('insert into snapshot_chainer (chainer_id,snapshot_id,name) values (?,?,?)', (oid, snap, f'OLD {n[:20]} {snap}'))
cols = 'src_cluster_type,src_cluster_type_index,src_section_type,src_section_index,src_channel_index,src_control_id,src_asgn_type,dst_cluster_type,dst_cluster_type_index,dst_section_type,dst_section_index,dst_channel_index,dst_control_id,dst_asgn_type,status'
def inp(slot, ch, kind, idx, side, status=0, section=0):
    db.execute(f'insert into routes ({cols}) values (10,?,-1,-1,?,-1,-1,?,?,0,?,?,0,0,?)', (slot, ch, kind, idx, section, side, status))
def outp(kind, idx, side, slot, ch, status=0):
    db.execute(f'insert into routes ({cols}) values (?,?,-1,-1,?,-1,-1,11,?,0,-1,?,0,0,?)', (kind, idx, side, slot, ch, status))
inp(1, 0, 0, 0, 0)            # STAGE LEFT 1 → KICK
inp(1, 14, 0, 1, 0); inp(1, 15, 0, 1, 1)   # STAGE LEFT 15/16 → OVERHEADS L/R
inp(1, 2, 0, 2, 0, status=4); inp(1, 2, 0, 3, 0)  # STAGE LEFT 3 split to VOX 1 and LEAD VOCAL
inp(1, 5, 0, 0, 0, status=1)  # a route not in use
inp(4, 0, 0, 3, 0, status=1, section=1)  # input B from the computer
inp(2, 16, 0, 4, 0); inp(2, 17, 0, 4, 1)  # DRUM RISER AES in → PLAYBACK ST
inp(1, 24, 0, 5, 0); inp(1, 25, 0, 6, 0)  # STAGE LEFT AES in: L to TB A, R to TB B (two channels, one socket)
inp(0, 0, 8, 0, 0, status=4)  # Classic IO (slot 0) 1 → talkback
inp(3, 9, 0, 2, 0, status=4)  # MADI 10 → VOX 1 as well
outp(25, 0, 0, 1, 0); outp(25, 0, 1, 1, 1)    # MON A → STAGE LEFT out 1/2
outp(2, 1, 0, 2, 12); outp(2, 1, 1, 2, 13)    # AUX B → DRUM RISER headphones 1
outp(3, 0, 0, 1, 12); outp(3, 0, 1, 1, 13)    # LR → STAGE LEFT out 13/14
outp(25, 2, 0, 1, 22); outp(25, 2, 1, 1, 23)  # MON C → STAGE LEFT AES out 1-2
outp(2, 0, 0, 0, 12); outp(2, 0, 1, 0, 13)    # AUX A → the Classic's headphones
outp(0, 0, 0, 4, 0)                            # KICK → the computer (recording): not a stage box
# Preamp settings, the way LV1 writes them: 48V on STAGE LEFT 15/16 (the
# overheads) and 6 (nothing patched); an older scene has 48V on input 1 too
def chunk(cid, device_id, on):
    lines = ['common:', f'  vendor_id: 21', f'  device_id: {device_id}', 'liverack:', '  clip_indication_threshold: 3', '  line_in_phantom_map:']
    lines += [f'    {i}: {1 if i in on else 0}' for i in range(24)]
    lines += ['  line_in_line_map:'] + [f'    {i}: 1' for i in range(24)]
    db.execute('insert into iom_chunks (id,ref_count,device_id,vendor_id,iom_chunk) values (?,?,?,?,?)', (cid, 1, device_id, 21, '\n'.join(lines) + '\n'))
chunk(1, 8, {5, 14, 15}); chunk(2, 8, {0, 5, 14, 15}); chunk(3, 0, set())
for snap, slot, cid in [(-1, 1, 1), (-1, 2, 3), (7, 1, 2)]:
    db.execute('insert into snapshot_iom (snapshot_id,iom_chunk_id,io_bank,io_slot) values (?,?,?,?)', (snap, cid, 0, slot))
db.commit(); db.execute('pragma journal_mode=delete'); db.execute('vacuum'); db.close()
print(os.path.getsize(out), 'bytes')
