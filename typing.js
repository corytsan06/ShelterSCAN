const headerText = "Find nearby emergency shelters.";
let index = 0;
const element = document.getElementById("typedText");

function typeWriter() {
  if (element && index < headerText.length) {
    element.textContent += headerText.charAt(index);
    index++;
    setTimeout(typeWriter, 100);
  }
}

typeWriter();
