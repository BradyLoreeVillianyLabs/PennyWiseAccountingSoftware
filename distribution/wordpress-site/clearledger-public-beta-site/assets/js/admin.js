(function ($) {
  "use strict";

  $(function () {
    $("[data-cl-media-row]").each(function () {
      var row = $(this);
      var id = row.find("[data-cl-media-id]");
      var url = row.find("[data-cl-media-url]");

      row.find("[data-cl-media-select]").on("click", function () {
        var frame = wp.media({
          title: "Choose a ClearLedger release file",
          button: { text: "Use this file" },
          multiple: false
        });

        frame.on("select", function () {
          var attachment = frame.state().get("selection").first().toJSON();
          id.val(attachment.id || "0");
          url.val(attachment.url || "");
        });
        frame.open();
      });

      row.find("[data-cl-media-clear]").on("click", function () {
        id.val("0");
        url.val("");
      });
    });
  });
})(jQuery);
