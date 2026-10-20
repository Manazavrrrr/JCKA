/**
 * Образец разметки витрины публичного канала.
 *
 * Это сокращённая копия страницы https://t.me/s/<канал>: оставлены опорные
 * классы, атрибут data-post, время публикации и подпись, убраны стили,
 * счётчики просмотров и служебные скрипты. Тексты объявлений — вымышленные,
 * как и всё остальное в демонстрационных данных.
 *
 * Образец нужен затем, что настоящая страница в тестах недоступна и
 * непостоянна: канал живёт своей жизнью, и тест, зависящий от его
 * содержимого, падал бы без всякой связи с кодом. Здесь же проверяется
 * ровно то, за что отвечает разбор: вытащить из разметки номер поста,
 * дату, автора и текст — и не потерять переводы строк.
 *
 * В образец намеренно включены неудобные случаи: пост без подписи (одна
 * картинка), подпись с ссылкой и жирным начертанием, HTML-сущности,
 * многострочный текст и вложенный <div> цитаты.
 */

export const TELEGRAM_FIXTURE_CHANNEL = 'ukg_novostroyki_demo';

export const TELEGRAM_FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>Новостройки ВКО ДЕМО</title></head>
<body>
<div class="tgme_page_wrap">
  <div class="tgme_channel_info">
    <div class="tgme_channel_info_header_title"><span dir="auto">Новостройки ВКО ДЕМО</span></div>
  </div>
  <section class="tgme_channel_history js-message_history">

    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${TELEGRAM_FIXTURE_CHANNEL}/1041" data-view="eyJjIjotMX0">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_author accent_color">
            <a class="tgme_widget_message_owner_name" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}"><span dir="auto">Новостройки ВКО ДЕМО</span></a>
          </div>
          <div class="tgme_widget_message_text js-message_text" dir="auto"><b>ЖК &laquo;Алтай Арман ДЕМО&raquo;</b><br/>Старт продаж от застройщика.<br/>Бронь квартиры &mdash; 150 000 &#8376;<br/>Ввод в эксплуатацию: IV кв. 2027<br/><a href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}" target="_blank">Записаться на просмотр</a></div>
          <div class="tgme_widget_message_footer compact js-message_footer">
            <div class="tgme_widget_message_info short js-message_info">
              <span class="tgme_widget_message_views">1.2K</span>
              <a class="tgme_widget_message_date" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}/1041"><time datetime="2026-10-10T09:15:00+00:00" class="time">09:15</time></a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${TELEGRAM_FIXTURE_CHANNEL}/1042">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_author accent_color">
            <a class="tgme_widget_message_owner_name" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}"><span dir="auto">Новостройки ВКО ДЕМО</span></a>
          </div>
          <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.example/photo.jpg')" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}/1042"></a>
          <div class="tgme_widget_message_footer compact js-message_footer">
            <div class="tgme_widget_message_info short js-message_info">
              <a class="tgme_widget_message_date" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}/1042"><time datetime="2026-10-10T11:40:00+00:00" class="time">11:40</time></a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${TELEGRAM_FIXTURE_CHANNEL}/1043">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_author accent_color">
            <a class="tgme_widget_message_owner_name" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}"><span dir="auto">Новостройки ВКО ДЕМО</span></a>
          </div>
          <div class="tgme_widget_message_text js-message_text" dir="auto">Сдам 2-комнатную квартиру посуточно, центр города.<div class="tgme_widget_message_reply"><div class="tgme_widget_message_text">Цена договорная</div></div>Звоните после 18:00.</div>
          <div class="tgme_widget_message_footer compact js-message_footer">
            <div class="tgme_widget_message_info short js-message_info">
              <a class="tgme_widget_message_date" href="https://t.me/${TELEGRAM_FIXTURE_CHANNEL}/1043"><time datetime="2026-10-11T07:05:00+00:00" class="time">07:05</time></a>
            </div>
          </div>
        </div>
      </div>
    </div>

  </section>
</div>
</body>
</html>`;

/** Ответ закрытого канала: витрины нет, читать нечего. */
export const TELEGRAM_FIXTURE_PRIVATE = `<!DOCTYPE html>
<html>
<head><title>Telegram: Contact @zakrytyy_demo</title></head>
<body>
<div class="tgme_page">
  <div class="tgme_page_title"><span dir="auto">Закрытый канал ДЕМО</span></div>
  <div class="tgme_page_extra">Private channel</div>
  <a class="tgme_action_button_new" href="tg://resolve?domain=zakrytyy_demo">View in Telegram</a>
</div>
</body>
</html>`;
