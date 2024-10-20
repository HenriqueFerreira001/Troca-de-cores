function trocacor(cor) {
    document.body.style.backgroundImage = 'none'
    document.body.style.backgroundColor = cor

}
function coraleatoria() {
    const red = Math.floor(math.ramdom() * 255)
    const green = Math.floor(math.ramdom() * 255)
    const blue = Math.floor(math.ramdom() * 255)


    document.body.style.backgroundImage = 'none'
    document.body.backgroundColor = `rgb(${red},${green},${blue})`
}
function aplicarcorPersonalizada() {
    const corinput = document.querySelector('.input-cor').value

    trocacor(corinput)
}

function escolherimagem(imagem) {
    const reader = new FileReader()
    reader.onload = function (evento) {
const urlimagem = evento.target.result

document.body.style.backgroundImage = `url('${urlimagem})`
    }

        reader.readAsDataURL(imagem)

}