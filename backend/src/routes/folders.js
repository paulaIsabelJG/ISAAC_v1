const express    = require('express');
const router     = express.Router();
const folderCtrl = require('../controllers/folderController');
const auth       = require('../middleware/authMiddleware');

router.use(auth);

router.get   ('/',           folderCtrl.getFolders);
router.post  ('/',           folderCtrl.createFolder);
router.put   ('/:folderId',  folderCtrl.renameFolder);
router.delete('/:folderId',  folderCtrl.deleteFolder);

module.exports = router;
