/* eslint-disable @typescript-eslint/no-var-requires */
// Writes tags back to audio files. music-metadata, used for every read in the
// app, is read-only, so this is the one place that mutates files on disk.
// Plain JS so the main process and test_tagWriter.js can both load it.
//
// `undefined` on a field means "leave it alone", so an album-wide edit only
// touches the fields the user actually changed.
const {
  ByteVector,
  File: TagFile,
  Id3v2FrameIdentifiers,
  Picture,
  PictureType,
  StringType,
  TagTypes,
} = require('node-taglib-sharp');

// Windows Explorer and Windows Media Player read album art out of ID3v2.3 and
// come up empty on 2.4, which taglib writes for a new tag. Everything else reads
// either, so 2.3 is the compatible choice.
//
// Must be set per file, on the tag, right before saving. Id3v2Settings.forceDefaultVersion
// looks like the switch for this and is not: it also applies to *parsing*, so an
// existing 2.4 tag gets misread and every frame from the mismatch on, APIC
// included, is silently dropped.
function renderAsId3v23(file) {
  if (file.tagTypes & TagTypes.Id3v2) {
    file.getTag(TagTypes.Id3v2, false).version = 3;
  }
}

// Picture.fromPath takes the MIME type from the file *name*, so a .jpg that is
// really a PNG travels with a MIME that contradicts its bytes: readers that
// trust the label (Windows) show nothing, readers that sniff (VLC) look fine.
function sniffImageMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  // RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }
  return null;
}

// taglib-sharp's cross-format Tag has no encoder property, so this reaches into
// whichever container tag the file actually carries. The keys match what
// music-metadata reads back as `common.encodedby`.
function writeEncodedBy(file, value) {
  const types = file.tagTypes;
  if (types & TagTypes.Id3v2) {
    file.getTag(TagTypes.Id3v2, false).setTextFrame(Id3v2FrameIdentifiers.TENC, value);
  }
  if (types & TagTypes.Xiph) {
    const xiph = file.getTag(TagTypes.Xiph, false);
    if (value) xiph.setFieldAsStrings('ENCODEDBY', value);
    else xiph.removeField('ENCODEDBY');
  }
  if (types & TagTypes.Apple) {
    file
      .getTag(TagTypes.Apple, false)
      .setQuickTimeString(ByteVector.fromString('©too', StringType.Latin1), value);
  }
}

function writeTags(filePath, fields) {
  const file = TagFile.createFromPath(filePath);
  try {
    const tag = file.tag;
    if (fields.title !== undefined) tag.title = fields.title;
    if (fields.artists !== undefined) tag.performers = fields.artists;
    if (fields.album !== undefined) tag.album = fields.album;
    if (fields.albumArtists !== undefined) tag.albumArtists = fields.albumArtists;
    if (fields.genres !== undefined) tag.genres = fields.genres;
    if (fields.comment !== undefined) tag.comment = fields.comment;
    // 0 is taglib's "unset" for the numeric fields.
    if (fields.year !== undefined) tag.year = fields.year || 0;
    if (fields.disc !== undefined) tag.disc = fields.disc || 0;
    if (fields.track !== undefined) tag.track = fields.track || 0;

    if (fields.artPath !== undefined) {
      if (fields.artPath === null) {
        tag.pictures = [];
      } else {
        const picture = Picture.fromPath(fields.artPath);
        picture.type = PictureType.FrontCover;
        // fromPath uses the file name, which for a copied cover is a temp path.
        picture.description = 'Cover';
        const mime = sniffImageMime(picture.data.toByteArray());
        if (mime) picture.mimeType = mime;
        tag.pictures = [picture];
      }
    }

    // Last, so a file that carried no tag at all now has one for the encoder
    // frame to hang off.
    if (fields.encodedBy !== undefined) writeEncodedBy(file, fields.encodedBy);

    renderAsId3v23(file);
    file.save();
  } finally {
    file.dispose();
  }
}

module.exports = { writeTags };
